"""
Solomon CrewAI Tools
Custom tools for agents to use during task execution.
"""

import os
import json
import time
import subprocess
import requests
from pathlib import Path
from crewai.tools import tool
from duckduckgo_search import DDGS


DELIVERABLES_DIR = Path('/root/solomon-bot/deliverables')
RELAY_URL = 'http://localhost:3001'

# Load API keys
OPENROUTER_KEY = os.getenv('OPENROUTER_API_KEY', '')
PERPLEXITY_KEY = os.getenv('PERPLEXITY_API_KEY', '')


@tool("Web Search")
def web_search_tool(query: str) -> str:
    """Search the web for current information. Use this to verify facts, find statistics, 
    research competitors, and gather real data. ALWAYS use this before citing any numbers or statistics.
    Returns search results with titles, URLs, and snippets."""
    
    # Try Perplexity Sonar first (better for research)
    if PERPLEXITY_KEY:
        try:
            response = requests.post(
                'https://api.perplexity.ai/chat/completions',
                headers={
                    'Authorization': f'Bearer {PERPLEXITY_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'sonar',
                    'messages': [{'role': 'user', 'content': query}],
                    'max_tokens': 2000,
                },
                timeout=30
            )
            if response.status_code == 200:
                data = response.json()
                answer = data.get('choices', [{}])[0].get('message', {}).get('content', '')
                if answer and len(answer) > 100:
                    return f"[Perplexity Sonar Results]\n{answer}"
        except Exception as e:
            print(f"[TOOL] Perplexity failed: {e}")
    
    # Fallback: DuckDuckGo
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=8))
        
        if not results:
            return f"No results found for: {query}"
        
        output = f"[DuckDuckGo Results for: {query}]\n\n"
        for i, r in enumerate(results, 1):
            output += f"{i}. **{r.get('title', 'No title')}**\n"
            output += f"   URL: {r.get('href', 'N/A')}\n"
            output += f"   {r.get('body', 'No snippet')}\n\n"
        
        return output
    except Exception as e:
        return f"Search failed: {str(e)}. Proceed with available knowledge and label estimates clearly."


@tool("Write File")
def file_write_tool(filename: str, content: str) -> str:
    """Write content to a file in the deliverables directory. 
    Use this to save reports, documents, and other deliverables.
    The filename should end in .md for markdown documents."""
    
    filepath = DELIVERABLES_DIR / filename
    filepath.write_text(content)
    return f"File written: {filepath} ({len(content)} chars)"


@tool("Read File")
def file_read_tool(filepath: str) -> str:
    """Read the contents of a file. Use this to read existing documents, 
    configuration files, or reference materials."""
    
    path = Path(filepath)
    if not path.exists():
        # Try in deliverables dir
        path = DELIVERABLES_DIR / filepath
    
    if not path.exists():
        return f"File not found: {filepath}"
    
    content = path.read_text()
    if len(content) > 10000:
        return content[:10000] + f"\n\n[... truncated, total {len(content)} chars]"
    return content


@tool("Send PC Agent Command")
def relay_command_tool(command_type: str, payload: str) -> str:
    """Send a command to Jed's Windows PC via the relay server.
    command_type: one of 'open_url', 'screenshot', 'powershell', 'close_tabs', 'disable_startup'
    payload: the command details (URL to open, PowerShell script, app name to disable, etc.)
    
    Only use this for tasks that TRULY require Jed's local machine.
    Most research and writing tasks do NOT need this."""
    
    try:
        command = {
            'id': f'crew_{int(time.time())}',
            'type': command_type,
            'payload': payload,
            'timestamp': int(time.time() * 1000),
        }
        
        response = requests.post(
            f'{RELAY_URL}/command/queue',
            json=command,
            timeout=10
        )
        
        if response.status_code == 200:
            return f"Command queued successfully: {command_type} - {payload}"
        else:
            return f"Command queue failed (HTTP {response.status_code}): {response.text}"
    except Exception as e:
        return f"Relay communication failed: {str(e)}. The PC Agent may be offline."


@tool("Generate PDF")
def pdf_generate_tool(markdown_content: str, title: str) -> str:
    """Convert markdown content to a PDF file. Returns the path to the generated PDF.
    Use this when you need to create a PDF deliverable from your work."""
    
    # Write markdown first
    filename = f"crewai_{title.replace(' ', '_')[:30]}_{int(time.time())}.md"
    md_path = DELIVERABLES_DIR / filename
    md_path.write_text(f"# {title}\n\n{markdown_content}")
    
    # Generate PDF
    pdf_path = str(md_path).replace('.md', '.pdf')
    
    try:
        result = subprocess.run(
            ['/usr/local/bin/manus-md-to-pdf', str(md_path), pdf_path],
            capture_output=True, text=True, timeout=60,
            env={**os.environ, 'PATH': f"/usr/local/bin:{os.environ.get('PATH', '')}"}
        )
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 500:
            return f"PDF generated: {pdf_path}"
    except Exception as e:
        pass
    
    # Fallback: weasyprint
    try:
        import markdown
        html_content = markdown.markdown(markdown_content, extensions=['tables', 'fenced_code'])
        styled_html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
        <style>body{{font-family:sans-serif;max-width:800px;margin:40px auto;padding:20px;line-height:1.6}}
        h1{{border-bottom:2px solid #333;padding-bottom:10px}}h2{{margin-top:30px}}
        table{{border-collapse:collapse;width:100%;margin:20px 0}}th,td{{border:1px solid #ddd;padding:8px}}
        th{{background:#f5f5f5}}code{{background:#f4f4f4;padding:2px 6px;border-radius:3px}}</style>
        </head><body>{html_content}</body></html>"""
        
        html_path = str(md_path).replace('.md', '.html')
        Path(html_path).write_text(styled_html)
        subprocess.run(['/usr/local/bin/weasyprint', html_path, pdf_path], 
                      capture_output=True, timeout=60)
        try: os.unlink(html_path)
        except: pass
        
        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 500:
            return f"PDF generated: {pdf_path}"
    except Exception as e:
        pass
    
    return f"PDF generation failed. Markdown saved at: {md_path}"
