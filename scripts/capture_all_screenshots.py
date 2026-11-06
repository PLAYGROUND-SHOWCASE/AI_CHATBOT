import asyncio
import json
import base64
import urllib.request
import websockets
import http.server
import socketserver
import threading
import subprocess
import time
import os

PORT = 8796
FRONTEND_DIR = r"D:\PROJECTS\AI_CHATBOT\zarvis\frontend"
OUTPUT_DIR = r"D:\PROJECTS\AI_CHATBOT\zarvis\screenshots"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)
    def log_message(self, *a): pass

server = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

chrome = subprocess.Popen([
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "--headless=new",
    "--remote-debugging-port=9246",
    "--window-size=1440,900",
    "about:blank"
])
time.sleep(2)

try:
    with urllib.request.urlopen("http://127.0.0.1:9246/json") as r:
        tabs = json.loads(r.read())
    ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")

    async def run():
        async with websockets.connect(ws_url, max_size=50_000_000) as ws:
            mid = 1
            async def cmd(method, params=None):
                nonlocal mid
                mid += 1
                req = {"id": mid, "method": method}
                if params: req["params"] = params
                await ws.send(json.dumps(req))
                while True:
                    d = json.loads(await ws.recv())
                    if d.get("id") == mid:
                        return d.get("result", {})

            async def eval_js(js):
                res = await cmd("Runtime.evaluate", {
                    "expression": f"(() => {{ {js} }})()",
                    "returnByValue": True
                })
                return res.get("result", {}).get("value")

            async def shot(filename):
                res = await cmd("Page.captureScreenshot", {"format": "png"})
                data = base64.b64decode(res["data"])
                out_path = os.path.join(OUTPUT_DIR, filename)
                with open(out_path, "wb") as f:
                    f.write(data)
                print(f"Captured: {filename} ({len(data):,} bytes)", flush=True)

            # Navigate
            await cmd("Page.navigate", {"url": f"http://127.0.0.1:{PORT}"})
            
            # 1. Boot sequence (capture mid-boot when 3 checks are done)
            await asyncio.sleep(2.0)
            await shot("01_boot_diagnostic.png")

            # Wait for full 5-second startup sequence to complete naturally
            await asyncio.sleep(3.5)

            # 2. Landing portal (clean, startup screen completely gone)
            await eval_js("""
                document.getElementById('startup-screen').style.display = 'none';
                document.getElementById('landing-page').classList.add('active');
            """)
            await asyncio.sleep(0.4)
            await shot("02_landing_portal.png")

            # 3. Auth Gateway (Login)
            await eval_js("""
                document.getElementById('startup-screen').style.display = 'none';
                document.getElementById('landing-page').classList.remove('active');
                window.zarvisApp._showAuth('login');
            """)
            await asyncio.sleep(0.4)
            await shot("03_auth_gateway.png")

            # 4. Enter Main App & Stub API/WS so no offline errors occur
            await eval_js("""
                window.zarvisApp.api.request = async () => [];
                document.getElementById('demo-link').click();
            """)
            await asyncio.sleep(0.6)

            await eval_js("""
                // Stop WS reconnect loop & clear warning notifications
                if (window.zarvisApp.ws) {
                    window.zarvisApp.ws. _shouldReconnect = false;
                    clearTimeout(window.zarvisApp.ws._reconnectTimer);
                }
                document.getElementById('startup-screen').style.display = 'none';
                document.getElementById('landing-page').classList.remove('active');
                document.getElementById('auth-screen').classList.remove('active');
                document.getElementById('main-app').classList.add('active');

                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';

                window.zarvisApp.state.user = { name: 'Commander Jayesh', email: 'jayesh@zarvis.ai' };
                window.zarvisApp.state.connected = true;
                window.zarvisApp.state.geminiAvailable = true;
                window.zarvisApp._updateUserUI();
                window.zarvisApp._updateTopbar();

                window.zarvisApp._loadMemories = async function() { this._renderMemories(); };
                window.zarvisApp._loadFiles = async function() { this._renderFiles(); };
                window.zarvisApp._loadConversations = async function() { this._renderConversationsList(); };

                window.zarvisApp.state.conversations = [
                    { id: 1, title: 'Quantum Computing Research & Gemini 1.5 Architecture', updated_at: new Date().toISOString() },
                    { id: 2, title: 'Financial Ledger & Real-Time Market Telemetry', updated_at: new Date(Date.now() - 3600000).toISOString() },
                    { id: 3, title: 'Voice Pipeline Optimization & Audio Codec Analysis', updated_at: new Date(Date.now() - 86400000).toISOString() },
                    { id: 4, title: 'Server Infrastructure & Docker Deployment Sync', updated_at: new Date(Date.now() - 172800000).toISOString() }
                ];
                window.zarvisApp.state.messages = Array(42).fill({});

                window.zarvisApp.state.memories = [
                    { id: 1, category: 'user_preferences', key: 'preferred_voice', value: 'Neural Futuristic Male (En-US)' },
                    { id: 2, category: 'user_preferences', key: 'default_personality', value: 'Professional Technical Advisor' },
                    { id: 3, category: 'active_projects', key: 'project_alpha', value: 'ZARVIS AI Autonomous Command Intelligence System' },
                    { id: 4, category: 'active_projects', key: 'target_repo', value: 'PLAYGROUND-SHOWCASE/Demo_Zarvis' },
                    { id: 5, category: 'personal_context', key: 'timezone', value: 'Asia/Kolkata (IST +05:30)' },
                    { id: 6, category: 'personal_context', key: 'primary_language', value: 'English (US & UK)' }
                ];

                window.zarvisApp.state.files = [
                    { id: 1, filename: 'ZARVIS_Architecture_Spec_v1.0.pdf', mime_type: 'application/pdf', size_bytes: 2457600, created_at: new Date().toISOString() },
                    { id: 2, filename: 'System_Telemetry_Q4_Metrics.csv', mime_type: 'text/csv', size_bytes: 524288, created_at: new Date(Date.now() - 3600000).toISOString() },
                    { id: 3, filename: 'Gemini_Multimodal_Prompt_Guide.docx', mime_type: 'text/plain', size_bytes: 184320, created_at: new Date(Date.now() - 7200000).toISOString() },
                    { id: 4, filename: 'Neural_Core_Visualization_HUD.png', mime_type: 'image/png', size_bytes: 1048576, created_at: new Date(Date.now() - 14400000).toISOString() }
                ];

                window.zarvisApp.state.tools = [
                    { name: 'calculator', description: 'Sandboxed mathematical evaluations and expression parsing', enabled: true },
                    { name: 'weather', description: 'Live meteorological telemetry and atmospheric pressure reports', enabled: true },
                    { name: 'time', description: 'Atomic clock time synchronization and global timezone conversion', enabled: true },
                    { name: 'web_search', description: 'DuckDuckGo privacy-focused web retrieval and deep summarization', enabled: true },
                    { name: 'system_status', description: 'Host hardware telemetry, CPU load, RAM allocation, and uptime', enabled: true }
                ];

                window.zarvisApp.state.settings = {
                    ai: { model: 'gemini-1.5-pro', personality: 'professional', temperature: 0.7 },
                    voice: { speed: 1.05, pitch: 1.0, auto_speak: true, language: 'en-US' }
                };

                window.zarvisApp.notifications.show('ZARVIS ONLINE — Ready for your command', 'success');
            """)
            await asyncio.sleep(0.5)

            # 4. Assistant Core
            await eval_js("window.zarvisApp._showPage('assistant');")
            await asyncio.sleep(0.5)
            await shot("04_assistant_core.png")

            # 5. Voice Waveform
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._setZarvisState('speaking');
                const wCanvas = document.getElementById('waveform-canvas');
                if (wCanvas) {
                    const ctx = wCanvas.getContext('2d');
                    ctx.clearRect(0, 0, wCanvas.width, wCanvas.height);
                    ctx.beginPath();
                    ctx.strokeStyle = '#00d4ff';
                    ctx.lineWidth = 2.5;
                    for (let x = 0; x < wCanvas.width; x += 3) {
                        const y = (wCanvas.height / 2) + Math.sin(x * 0.08) * 16 * Math.cos(x * 0.02);
                        if (x === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                }
            """)
            await asyncio.sleep(0.5)
            await shot("05_voice_waveform.png")

            # 6. Tool Execution
            await eval_js("""
                window.zarvisApp._setZarvisState('idle');
                window.zarvisApp._addMessage('user', 'What is the current weather in Tokyo and calculate 485 * 24?');
                window.zarvisApp._addToolCard('weather', 'completed', { location: 'Tokyo, JP', temp_c: 18.5, condition: 'Partly Cloudy', humidity: '58%' });
                window.zarvisApp._addToolCard('calculator', 'completed', { expression: '485 * 24', result: 11640 });
                window.zarvisApp._addMessage('assistant', 'The current weather in Tokyo is 18.5°C with partly cloudy skies and 58% humidity. The calculation of 485 × 24 equals **11,640**.');
            """)
            await asyncio.sleep(0.5)
            await shot("06_tool_execution.png")

            # 7. Dashboard
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('dashboard');
                window.zarvisApp._renderDashboard();
            """)
            await asyncio.sleep(0.5)
            await shot("07_telemetry_dashboard.png")

            # 8. Conversations
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('conversations');
                window.zarvisApp._renderConversationsList();
            """)
            await asyncio.sleep(0.5)
            await shot("08_conversations_manager.png")

            # 9. Memory
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('memory');
                window.zarvisApp._renderMemories();
            """)
            await asyncio.sleep(0.5)
            await shot("09_memory_bank.png")

            # 10. Tools
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('tools');
                window.zarvisApp._renderTools();
            """)
            await asyncio.sleep(0.5)
            await shot("10_tools_registry.png")

            # 11. Files
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('files');
                window.zarvisApp._renderFiles();
            """)
            await asyncio.sleep(0.5)
            await shot("11_multimodal_vault.png")

            # 12. Settings
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('settings');
                window.zarvisApp._renderSettings();
            """)
            await asyncio.sleep(0.5)
            await shot("12_system_settings.png")

            # 13. Command Palette
            await eval_js("""
                const notifContainer = document.getElementById('notification-container');
                if (notifContainer) notifContainer.innerHTML = '';
                window.zarvisApp._showPage('assistant');
                window.zarvisApp.commandPalette.open();
            """)
            await asyncio.sleep(0.5)
            await shot("13_command_palette.png")

            print("COMPLETE! All 13 distinct screenshots captured.", flush=True)

    asyncio.run(run())
finally:
    chrome.terminate()
    chrome.wait()
    server.shutdown()
    server.server_close()
