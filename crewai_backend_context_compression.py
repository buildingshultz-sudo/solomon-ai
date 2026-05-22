"""
Context Compression Module for Solomon CrewAI Backend.

Manages conversation history compression to prevent context window decay
on long-running tasks. Summarizes history when it exceeds thresholds and
stores compressed summaries for restart recovery.
"""

import json
import os
import time
from pathlib import Path
from datetime import datetime

SUMMARIES_FILE = Path('/root/solomon-bot/conversation_summaries.json')
RAW_HISTORY_FILE = Path('/root/solomon-bot/conversation_history.json')
MAX_MESSAGES = 50  # Compress after 50 messages
MAX_TOKENS_ESTIMATE = 10000  # ~10K tokens threshold (rough: 4 chars = 1 token)
MAX_CHARS = MAX_TOKENS_ESTIMATE * 4  # 40,000 chars ≈ 10K tokens


def load_summaries():
    """Load existing conversation summaries."""
    if SUMMARIES_FILE.exists():
        try:
            return json.loads(SUMMARIES_FILE.read_text())
        except json.JSONDecodeError:
            return {'summaries': [], 'last_compressed': None}
    return {'summaries': [], 'last_compressed': None}


def save_summaries(data):
    """Save conversation summaries to disk."""
    SUMMARIES_FILE.write_text(json.dumps(data, indent=2))


def load_history():
    """Load raw conversation history."""
    if RAW_HISTORY_FILE.exists():
        try:
            return json.loads(RAW_HISTORY_FILE.read_text())
        except json.JSONDecodeError:
            return {'messages': [], 'total_processed': 0}
    return {'messages': [], 'total_processed': 0}


def save_history(data):
    """Save raw conversation history."""
    RAW_HISTORY_FILE.write_text(json.dumps(data, indent=2))


def add_message(role, content, task_id=None, metadata=None):
    """Add a message to conversation history. Triggers compression if threshold exceeded."""
    history = load_history()
    
    message = {
        'role': role,
        'content': content[:2000],  # Cap individual messages at 2000 chars
        'timestamp': datetime.now().isoformat(),
        'task_id': task_id,
    }
    if metadata:
        message['metadata'] = metadata
    
    history['messages'].append(message)
    history['total_processed'] = history.get('total_processed', 0) + 1
    
    # Check if compression is needed
    needs_compression = (
        len(history['messages']) >= MAX_MESSAGES or
        sum(len(m.get('content', '')) for m in history['messages']) >= MAX_CHARS
    )
    
    save_history(history)
    
    if needs_compression:
        compress_history()
    
    return needs_compression


def compress_history(llm_summarize=None):
    """
    Compress conversation history into a summary.
    
    If llm_summarize is provided (a callable), uses it to generate an AI summary.
    Otherwise, creates a structured extraction of key facts.
    """
    history = load_history()
    
    if len(history['messages']) < 10:
        return  # Not enough to compress
    
    # Extract key information from messages
    messages_to_compress = history['messages'][:-5]  # Keep last 5 messages as recent context
    remaining_messages = history['messages'][-5:]
    
    if llm_summarize:
        # Use LLM to create intelligent summary
        messages_text = '\n'.join([
            f"[{m['role']}] ({m.get('timestamp', 'unknown')}): {m['content']}"
            for m in messages_to_compress
        ])
        summary_text = llm_summarize(
            f"Summarize this conversation history into key facts, decisions made, "
            f"tasks completed, and current state. Be concise but preserve all important details:\n\n"
            f"{messages_text[:8000]}"
        )
    else:
        # Structured extraction (no LLM needed)
        tasks_mentioned = set()
        decisions = []
        key_facts = []
        
        for msg in messages_to_compress:
            content = msg.get('content', '')
            # Extract task references
            if msg.get('task_id'):
                tasks_mentioned.add(msg['task_id'])
            # Extract decisions (messages with strong action words)
            if any(word in content.lower() for word in ['decided', 'approved', 'confirmed', 'will do', 'completed', 'fixed']):
                decisions.append(content[:200])
            # Extract key facts (short, informative messages)
            if len(content) < 300 and msg['role'] in ('user', 'system'):
                key_facts.append(content)
        
        summary_text = f"""## Conversation Summary ({datetime.now().strftime('%Y-%m-%d %H:%M')})
**Period:** {messages_to_compress[0].get('timestamp', 'unknown')} to {messages_to_compress[-1].get('timestamp', 'unknown')}
**Messages compressed:** {len(messages_to_compress)}

### Tasks Referenced
{chr(10).join(f'- {t}' for t in list(tasks_mentioned)[:20]) or '- None tracked'}

### Key Decisions
{chr(10).join(f'- {d[:150]}' for d in decisions[:10]) or '- None recorded'}

### Key Facts
{chr(10).join(f'- {f[:150]}' for f in key_facts[:15]) or '- None extracted'}
"""
    
    # Save the summary
    summaries = load_summaries()
    summaries['summaries'].append({
        'timestamp': datetime.now().isoformat(),
        'messages_compressed': len(messages_to_compress),
        'summary': summary_text,
    })
    
    # Keep only last 10 summaries
    if len(summaries['summaries']) > 10:
        summaries['summaries'] = summaries['summaries'][-10:]
    
    summaries['last_compressed'] = datetime.now().isoformat()
    save_summaries(summaries)
    
    # Replace history with only recent messages
    history['messages'] = remaining_messages
    save_history(history)
    
    return summary_text


def get_context_for_restart():
    """
    Get the full context needed after a restart.
    Returns the last summary + recent messages for seamless continuation.
    """
    summaries = load_summaries()
    history = load_history()
    
    context_parts = []
    
    # Add last 2 summaries for context
    if summaries['summaries']:
        for s in summaries['summaries'][-2:]:
            context_parts.append(s['summary'])
    
    # Add recent messages
    if history['messages']:
        recent = '\n'.join([
            f"[{m['role']}] {m['content'][:500]}"
            for m in history['messages'][-10:]
        ])
        context_parts.append(f"## Recent Messages\n{recent}")
    
    return '\n\n---\n\n'.join(context_parts) if context_parts else "No previous conversation history."


def get_stats():
    """Get compression statistics."""
    summaries = load_summaries()
    history = load_history()
    
    return {
        'current_messages': len(history.get('messages', [])),
        'total_processed': history.get('total_processed', 0),
        'summaries_stored': len(summaries.get('summaries', [])),
        'last_compressed': summaries.get('last_compressed'),
        'threshold_messages': MAX_MESSAGES,
        'threshold_chars': MAX_CHARS,
    }


# Flask route integration helper
def register_routes(app):
    """Register context compression API routes with Flask app."""
    from flask import jsonify, request
    
    @app.route('/context/stats', methods=['GET'])
    def context_stats():
        return jsonify(get_stats())
    
    @app.route('/context/history', methods=['POST'])
    def add_to_history():
        data = request.get_json()
        compressed = add_message(
            role=data.get('role', 'system'),
            content=data.get('content', ''),
            task_id=data.get('task_id'),
            metadata=data.get('metadata')
        )
        return jsonify({'stored': True, 'compressed': compressed})
    
    @app.route('/context/restart', methods=['GET'])
    def restart_context():
        return jsonify({'context': get_context_for_restart()})
    
    @app.route('/context/compress', methods=['POST'])
    def force_compress():
        summary = compress_history()
        return jsonify({'compressed': True, 'summary': summary})
