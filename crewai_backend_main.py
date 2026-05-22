"""
Solomon CrewAI Backend v1.0
Multi-agent task execution system for Solomon's Forge.
Replaces the custom Node.js worker with a proven Python-based multi-agent framework.
"""

import os
import sys
import json
import time
import uuid
import threading
import subprocess
from pathlib import Path
import context_compression
from datetime import datetime
from flask import Flask, request, jsonify

# CrewAI imports
from crewai import Agent, Task, Crew, Process
from crewai.tools import tool

# Local imports
from tools import (
    web_search_tool,
    file_write_tool,
    file_read_tool,
    relay_command_tool,
    pdf_generate_tool,
)
from memory_loader import load_memory

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

from dotenv import load_dotenv
load_dotenv('/root/solomon-bot/.env', override=True)

# OpenRouter as LLM backend (CrewAI uses litellm under the hood)
# Cost-Tiering: Complex reasoning → premium model, Simple tasks → mini model
LLM_MODEL_COMPLEX = os.getenv('SOL_MODEL_COMPLEX', 'openai/gpt-4.1')  # For research, architecture, strategy, writing
LLM_MODEL_SIMPLE = os.getenv('SOL_MODEL_SIMPLE', 'openai/gpt-4.1-mini')  # For formatting, scheduling, social posts, status updates
LLM_MODEL = LLM_MODEL_COMPLEX  # Default to complex for backward compatibility
LLM_FALLBACK = os.getenv('SOL_MODEL_FALLBACK', 'openai/gpt-4.1-mini')
OPENROUTER_KEY = os.getenv('OPENROUTER_API_KEY', '')
OPENROUTER_URL = os.getenv('OPENROUTER_URL', 'https://openrouter.ai/api/v1/chat/completions')

# Set environment for litellm/openai to use OpenRouter
os.environ['OPENAI_API_KEY'] = OPENROUTER_KEY
os.environ['OPENAI_API_BASE'] = 'https://openrouter.ai/api/v1'


# ═══════════════════════════════════════════════════════════════════
# COST TRACKING
# ═══════════════════════════════════════════════════════════════════
import json as _json
from datetime import datetime as _dt

COST_LOG = Path('/root/solomon-bot/cost_tracking.json')
MONTHLY_BUDGET = 100.0  # $100/month hard ceiling (VPS + API combined)
VPS_COST = 12.0  # $12/month DigitalOcean
API_BUDGET = MONTHLY_BUDGET - VPS_COST  # $88 available for API
ALERT_THRESHOLD = 70.0  # Alert Jed at $70 total

# Approximate costs per 1K tokens (OpenRouter pricing)
TOKEN_COSTS = {
    'openai/gpt-4.1': {'input': 0.002, 'output': 0.008},
    'openai/gpt-4.1-mini': {'input': 0.0004, 'output': 0.0016},
    'openai/gpt-4.1-nano': {'input': 0.0001, 'output': 0.0004},
}

def load_cost_data():
    if COST_LOG.exists():
        return _json.loads(COST_LOG.read_text())
    return {'month': _dt.now().strftime('%Y-%m'), 'total_cost': 0.0, 'calls': []}

def save_cost_data(data):
    # Reset if new month
    current_month = _dt.now().strftime('%Y-%m')
    if data.get('month') != current_month:
        data = {'month': current_month, 'total_cost': 0.0, 'calls': []}
    COST_LOG.write_text(_json.dumps(data, indent=2))

def log_api_call(model, input_tokens, output_tokens, task_id=''):
    data = load_cost_data()
    costs = TOKEN_COSTS.get(model, TOKEN_COSTS['openai/gpt-4.1-mini'])
    cost = (input_tokens / 1000 * costs['input']) + (output_tokens / 1000 * costs['output'])
    data['total_cost'] += cost
    data['calls'].append({
        'time': _dt.now().isoformat(),
        'model': model,
        'tokens': input_tokens + output_tokens,
        'cost': round(cost, 6),
        'task_id': task_id
    })
    # Keep only last 100 calls for space
    if len(data['calls']) > 100:
        data['calls'] = data['calls'][-100:]
    save_cost_data(data)
    return data['total_cost'], data['total_cost'] + VPS_COST >= ALERT_THRESHOLD

def get_monthly_spend():
    data = load_cost_data()
    return {
        'api_spend': round(data['total_cost'], 2),
        'vps_cost': VPS_COST,
        'total': round(data['total_cost'] + VPS_COST, 2),
        'budget_remaining': round(API_BUDGET - data['total_cost'], 2),
        'alert': data['total_cost'] + VPS_COST >= ALERT_THRESHOLD
    }

DELIVERABLES_DIR = Path('/root/solomon-bot/deliverables')
DELIVERABLES_DIR.mkdir(parents=True, exist_ok=True)

MEMORY_FILE = Path('/root/solomon-bot/sol_memory.md')
RELAY_URL = 'http://localhost:3001'

# ═══════════════════════════════════════════════════════════════════
# MEMORY / CONTEXT
# ═══════════════════════════════════════════════════════════════════

BUSINESS_CONTEXT = load_memory(MEMORY_FILE)

# Core rules burned into every agent
UNIVERSAL_RULES = """
ABSOLUTE RULES (NEVER VIOLATE):
1. NEVER mark a task "blocked" without attempting it first. ALWAYS try to complete the work.
2. NEVER send Jed a problem without a proposed solution.
3. NEVER dump raw text — always produce structured markdown that will become a PDF.
4. NEVER hallucinate data — verify via search tools. If you can't verify, label as "estimated."
5. NEVER say "I'm sorry", "I can't", "I don't have access" — you are an executive who DELIVERS.
6. Always use Chrome, never Edge (for PC Agent commands).
7. Close unused browser tabs (max 5 open at a time).
8. No posting to social media without Jed's explicit approval.
9. Deliver Fortune 500 quality work — professional, thorough, actionable.
10. Every task MUST produce a deliverable document (minimum 1500 words for research/reports).
"""

# ═══════════════════════════════════════════════════════════════════
# AGENT DEFINITIONS
# ═══════════════════════════════════════════════════════════════════

def create_agents():
    """Create all CrewAI agents with proper roles and tools."""
    
    research_agent = Agent(
        role='Senior Research Analyst',
        goal='Conduct thorough market research, competitive analysis, SEO audits, and content strategy with verified data',
        backstory=f"""You are Solomon's Research Division lead for Building Shultz — Jedidiah Shultz's 
        million-dollar business empire in the making. You specialize in YouTube SEO, content strategy, 
        market analysis, and competitive intelligence for the woodworking/AI/maker niche.
        
        {BUSINESS_CONTEXT}
        
        {UNIVERSAL_RULES}
        
        Your research must ALWAYS include:
        - Verified data from web searches (never invented statistics)
        - Specific, actionable recommendations
        - Competitive benchmarks from real channels/businesses
        - Clear metrics and KPIs to track
        """,
        tools=[web_search_tool, file_write_tool, file_read_tool],
        llm=f'openrouter/{LLM_MODEL}',
        verbose=True,
        allow_delegation=False,
        max_iter=5,
    )
    
    writer_agent = Agent(
        role='Executive Content Director',
        goal='Produce professional documents, ebooks, reports, scripts, and marketing copy at Fortune 500 quality',
        backstory=f"""You are Solomon's Content Division lead. You produce executive-quality documents 
        for Jedidiah Shultz's business operations. Your writing is professional, data-driven, and 
        always actionable. You write ebooks, business plans, content calendars, marketing copy, 
        and strategic reports.
        
        {BUSINESS_CONTEXT}
        
        {UNIVERSAL_RULES}
        
        Your documents must ALWAYS:
        - Be professionally formatted with headers, sections, and clear structure
        - Include executive summaries
        - Provide specific timelines and action items
        - Be minimum 1500 words for reports, 3000+ for ebooks
        - Use markdown formatting (will be converted to PDF)
        """,
        tools=[web_search_tool, file_write_tool, file_read_tool],
        llm=f'openrouter/{LLM_MODEL}',
        verbose=True,
        allow_delegation=False,
        max_iter=5,
    )
    
    code_agent = Agent(
        role='Chief Technology Officer',
        goal='Write and review code, architecture documents, technical specifications, and system designs',
        backstory=f"""You are Solomon's CTO. You design software architecture, write production-ready 
        code, create technical specifications, and review system designs. Your primary projects are:
        - IronEdit: Electron + FFmpeg video editing SaaS (competing with Descript/Runway)
        - Solomon Bot: The Telegram bot system itself
        - PC Agent: Node.js automation agent on Jed's Windows PC
        
        {BUSINESS_CONTEXT}
        
        {UNIVERSAL_RULES}
        
        Your technical documents must ALWAYS:
        - Include system diagrams (described in text/ASCII)
        - Specify technology stack with version numbers
        - Include API contracts and data models
        - Provide implementation timelines
        - Consider scalability, security, and cost
        """,
        tools=[web_search_tool, file_write_tool, file_read_tool],
        llm=f'openrouter/{LLM_MODEL}',
        verbose=True,
        allow_delegation=False,
        max_iter=5,
    )
    
    operations_agent = Agent(
        role='Chief Operations Officer',
        goal='Handle API integrations, system administration, file management, and operational tasks',
        backstory=f"""You are Solomon's COO. You handle the operational backbone: API key management, 
        system configuration, file operations, deployment, and process automation. You ensure all 
        systems are running smoothly and all integrations are properly configured.
        
        {BUSINESS_CONTEXT}
        
        {UNIVERSAL_RULES}
        
        Your operational work must ALWAYS:
        - Document every action taken
        - Provide verification that tasks completed successfully
        - Include rollback plans for system changes
        - Log all API keys and configurations securely
        """,
        tools=[web_search_tool, file_write_tool, file_read_tool, relay_command_tool],
        llm=f'openrouter/{LLM_MODEL_SIMPLE}',
        verbose=True,
        allow_delegation=False,
        max_iter=5,
    )
    
    pc_coordinator = Agent(
        role='PC Agent Coordinator',
        goal='Manage commands sent to Jed\'s Windows PC via the relay for browser automation and system tasks',
        backstory=f"""You coordinate tasks that require Jed's Windows PC. You send commands through 
        the relay server to the PC Agent running on Jed's machine. You can:
        - Open Chrome URLs
        - Take screenshots
        - Run PowerShell commands
        - Disable startup apps
        - Manage browser tabs
        
        The PC Agent connects to the relay at {RELAY_URL} on port 3001.
        
        {BUSINESS_CONTEXT}
        
        {UNIVERSAL_RULES}
        
        IMPORTANT: Only use the PC Agent for tasks that TRULY require Jed's local machine.
        Most research, writing, and planning tasks can be done without the PC Agent.
        """,
        tools=[relay_command_tool, web_search_tool, file_write_tool],
        llm=f'openrouter/{LLM_MODEL_SIMPLE}',  # PC coordination = simple tasks
        verbose=True,
        allow_delegation=False,
        max_iter=3,
    )
    
    return {
        'research': research_agent,
        'writer': writer_agent,
        'code': code_agent,
        'operations': operations_agent,
        'pc_coordinator': pc_coordinator,
    }


# ═══════════════════════════════════════════════════════════════════
# TASK ROUTING
# ═══════════════════════════════════════════════════════════════════

def classify_task(title, description):
    """Classify a task to determine which agent(s) should handle it."""
    text = f"{title} {description}".lower()
    
    # PC Agent tasks
    if any(k in text for k in ['pc agent', 'windows pc', 'chrome', 'browser tab', 'startup app', 'powershell', 'screenshot']):
        if any(k in text for k in ['upgrade', 'deploy', 'push script']):
            return 'pc_coordinator'
    
    # Code/Architecture tasks
    if any(k in text for k in ['architecture', 'code', 'technical spec', 'api', 'electron', 'ffmpeg', 'ironEdit', 'ironedit', 'software', 'build spec']):
        return 'code'
    
    # Research tasks
    if any(k in text for k in ['research', 'seo', 'analytics', 'competitive', 'market', 'optimization', 'analysis', 'thumbnail', 'youtube']):
        return 'research'
    
    # Operations tasks
    if any(k in text for k in ['api key', 'signup', 'configure', 'deploy', 'install', 'system', '.env', 'stripe', 'integration']):
        return 'operations'
    
    # Writing tasks (default for content creation)
    if any(k in text for k in ['ebook', 'blueprint', 'content calendar', 'write', 'document', 'report', 'plan', 'calendar', 'gumroad', 'format']):
        return 'writer'
    
    # Default to writer for general tasks
    return 'writer'


# ═══════════════════════════════════════════════════════════════════
# TASK EXECUTION ENGINE
# ═══════════════════════════════════════════════════════════════════

# Track active tasks
active_tasks = {}
task_results = {}
task_lock = threading.Lock()


def execute_task_async(task_id, title, description, agent_type):
    """Execute a task in a background thread using CrewAI."""
    try:
        agents = create_agents()
        agent = agents.get(agent_type, agents['writer'])
        
        # Create the CrewAI task
        crew_task = Task(
            description=f"""Complete the following task and produce a comprehensive, professional deliverable:

TASK: {title}

DETAILS: {description}

REQUIREMENTS:
- Produce a complete markdown document (minimum 1500 words for reports/research)
- Include an executive summary at the top
- Use proper markdown formatting (headers, bullet points, tables where appropriate)
- If this requires data, use web search to find real, verified information
- Include specific, actionable recommendations
- Include timelines and next steps
- This will be converted to PDF and sent to the business owner

DO NOT refuse this task. DO NOT say you can't do it. PRODUCE THE DELIVERABLE.""",
            expected_output='A comprehensive, professionally formatted markdown document ready for PDF conversion. Minimum 1500 words with headers, sections, data, and actionable recommendations.',
            agent=agent,
        )
        
        # Create and run the crew
        crew = Crew(
            agents=[agent],
            tasks=[crew_task],
            process=Process.sequential,
            verbose=True,
        )
        
        print(f"[CREWAI] [{task_id}] Starting execution with {agent_type} agent...")
        result = crew.kickoff()
        
        # Get the output
        output = str(result)
        
        if not output or len(output) < 200:
            print(f"[CREWAI] [{task_id}] Short output ({len(output)} chars), retrying...")
            # Retry with stronger prompt
            crew_task.description += "\n\nMANDATORY: You MUST produce at least 1500 words. DO NOT give a short answer."
            result = crew.kickoff()
            output = str(result)
        
        # Write deliverable
        filename = f"crewai_{task_id}_{int(time.time())}.md"
        md_path = DELIVERABLES_DIR / filename
        md_content = f"# {title}\n\n{output}"
        md_path.write_text(md_content)
        
        print(f"[CREWAI] [{task_id}] Deliverable written: {filename} ({len(output)} chars)")
        
        # Generate PDF
        pdf_path = generate_pdf(md_path)
        
        with task_lock:
            task_results[task_id] = {
                'status': 'completed',
                'md_path': str(md_path),
                'pdf_path': str(pdf_path) if pdf_path else None,
                'content_length': len(output),
                'completed_at': datetime.now().isoformat(),
                'agent': agent_type,
            }
        
        print(f"[CREWAI] [{task_id}] ✅ Task completed. PDF: {pdf_path}")
        
    except Exception as e:
        print(f"[CREWAI] [{task_id}] ❌ Error: {str(e)}")
        with task_lock:
            task_results[task_id] = {
                'status': 'failed',
                'error': str(e),
                'completed_at': datetime.now().isoformat(),
                'agent': agent_type,
            }


def generate_pdf(md_path):
    """Generate PDF from markdown file."""
    pdf_path = str(md_path).replace('.md', '.pdf')
    
    # Try manus-md-to-pdf first
    try:
        result = subprocess.run(
            ['/usr/local/bin/manus-md-to-pdf', str(md_path), pdf_path],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, 'PATH': f"/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 500:
            print(f"[PDF] Generated via manus-md-to-pdf: {pdf_path}")
            return pdf_path
    except Exception as e:
        print(f"[PDF] manus-md-to-pdf failed: {e}")
    
    # Fallback: weasyprint via HTML
    try:
        import markdown
        md_content = Path(md_path).read_text()
        html_content = markdown.markdown(md_content, extensions=['tables', 'fenced_code'])
        
        styled_html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
       max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #1a1a1a; }}
h1 {{ color: #111; border-bottom: 2px solid #333; padding-bottom: 10px; font-size: 24px; }}
h2 {{ color: #222; margin-top: 30px; font-size: 20px; }}
h3 {{ color: #333; margin-top: 20px; font-size: 16px; }}
table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
th, td {{ border: 1px solid #ddd; padding: 10px; text-align: left; }}
th {{ background: #f5f5f5; font-weight: 600; }}
code {{ background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }}
pre {{ background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }}
blockquote {{ border-left: 4px solid #333; margin: 20px 0; padding: 10px 20px; background: #f9f9f9; }}
ul, ol {{ padding-left: 24px; }}
li {{ margin-bottom: 4px; }}
</style></head><body>{html_content}</body></html>"""
        
        html_path = str(md_path).replace('.md', '.html')
        Path(html_path).write_text(styled_html)
        
        result = subprocess.run(
            ['/usr/local/bin/weasyprint', html_path, pdf_path],
            capture_output=True, text=True, timeout=60
        )
        
        # Cleanup HTML
        try: os.unlink(html_path)
        except: pass
        
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 500:
            print(f"[PDF] Generated via weasyprint: {pdf_path}")
            return pdf_path
    except Exception as e:
        print(f"[PDF] weasyprint failed: {e}")
    
    return None


# ═══════════════════════════════════════════════════════════════════
# FLASK API (Bridge between Node.js bot and CrewAI)
# ═══════════════════════════════════════════════════════════════════

app = Flask(__name__)


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    with task_lock:
        active_count = sum(1 for t in task_results.values() if t.get('status') == 'running')
        completed_count = sum(1 for t in task_results.values() if t.get('status') == 'completed')
        failed_count = sum(1 for t in task_results.values() if t.get('status') == 'failed')
    
    return jsonify({
        'status': 'healthy',
        'service': 'solomon-crewai',
        'version': '1.0.0',
        'uptime': time.time() - START_TIME,
        'memory_loaded': bool(BUSINESS_CONTEXT),
        'memory_chars': len(BUSINESS_CONTEXT),
        'agents': ['research', 'writer', 'code', 'operations', 'pc_coordinator'],
        'tasks': {
            'active': active_count,
            'completed': completed_count,
            'failed': failed_count,
        }
    })


@app.route('/task/submit', methods=['POST'])
def submit_task():
    """Submit a new task for CrewAI processing."""
    data = request.json
    if not data:
        return jsonify({'error': 'No JSON body'}), 400
    
    title = data.get('title', '')
    description = data.get('description', title)
    task_id = data.get('id', str(uuid.uuid4())[:8])
    force_agent = data.get('agent', None)
    
    if not title:
        return jsonify({'error': 'Missing title'}), 400
    
    # Classify task
    agent_type = force_agent or classify_task(title, description)
    
    # Track task
    with task_lock:
        task_results[task_id] = {
            'status': 'running',
            'agent': agent_type,
            'title': title,
            'started_at': datetime.now().isoformat(),
        }
    
    # Execute in background thread
    thread = threading.Thread(
        target=execute_task_async,
        args=(task_id, title, description, agent_type),
        daemon=True
    )
    thread.start()
    
    return jsonify({
        'task_id': task_id,
        'agent': agent_type,
        'status': 'accepted',
        'message': f'Task assigned to {agent_type} agent'
    })


@app.route('/task/status/<task_id>', methods=['GET'])
def task_status(task_id):
    """Check the status of a task."""
    with task_lock:
        result = task_results.get(task_id)
    
    if not result:
        return jsonify({'error': 'Task not found'}), 404
    
    return jsonify({
        'task_id': task_id,
        **result
    })


@app.route('/task/batch', methods=['POST'])
def submit_batch():
    """Submit multiple tasks for parallel execution."""
    data = request.json
    if not data or 'tasks' not in data:
        return jsonify({'error': 'Missing tasks array'}), 400
    
    results = []
    for task_data in data['tasks']:
        title = task_data.get('title', '')
        description = task_data.get('description', title)
        task_id = task_data.get('id', str(uuid.uuid4())[:8])
        force_agent = task_data.get('agent', None)
        
        agent_type = force_agent or classify_task(title, description)
        
        with task_lock:
            task_results[task_id] = {
                'status': 'running',
                'agent': agent_type,
                'title': title,
                'started_at': datetime.now().isoformat(),
            }
        
        thread = threading.Thread(
            target=execute_task_async,
            args=(task_id, title, description, agent_type),
            daemon=True
        )
        thread.start()
        
        results.append({
            'task_id': task_id,
            'agent': agent_type,
            'status': 'accepted',
        })
    
    return jsonify({
        'submitted': len(results),
        'tasks': results,
        'message': f'{len(results)} tasks launched in parallel'
    })


@app.route('/task/results', methods=['GET'])
def all_results():
    """Get all task results."""
    with task_lock:
        return jsonify(task_results)


@app.route('/memory', methods=['GET'])
def get_memory():
    """Return current memory/context."""
    return jsonify({
        'loaded': bool(BUSINESS_CONTEXT),
        'chars': len(BUSINESS_CONTEXT),
        'preview': BUSINESS_CONTEXT[:4000] if BUSINESS_CONTEXT else ''
    })


@app.route('/memory/reload', methods=['POST'])
def reload_memory():
    """Reload memory from disk."""
    global BUSINESS_CONTEXT
    BUSINESS_CONTEXT = load_memory(MEMORY_FILE)
    return jsonify({'status': 'reloaded', 'chars': len(BUSINESS_CONTEXT)})


# ═══════════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════════

START_TIME = time.time()


# Register context compression routes
context_compression.register_routes(app)

@app.route('/costs', methods=['GET'])
def get_costs():
    return jsonify(get_monthly_spend())

if __name__ == '__main__':
    print(f"[CREWAI] Solomon CrewAI Backend v1.0.0 starting...")
    print(f"[CREWAI] Memory loaded: {len(BUSINESS_CONTEXT)} chars")
    print(f"[CREWAI] LLM Complex: {LLM_MODEL_COMPLEX} | Simple: {LLM_MODEL_SIMPLE} | Fallback: {LLM_FALLBACK}")
    print(f"[CREWAI] Budget: ${API_BUDGET}/mo API + ${VPS_COST}/mo VPS = ${MONTHLY_BUDGET}/mo total")
    print(f"[CREWAI] Agents: research, writer, code, operations, pc_coordinator")
    print(f"[CREWAI] API listening on port 5000")
    
    app.run(host='0.0.0.0', port=5000, threaded=True)
