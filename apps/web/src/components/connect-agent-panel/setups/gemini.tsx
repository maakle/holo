import { type CopyHandler } from '../lib';
import { InlineCode, Snippet, Step } from '../snippet';

/**
 * Gemini doesn't speak MCP natively. The pattern is: declare a function tool
 * whose schema mirrors holo's REST endpoint, let Gemini decide when to call
 * it, then dispatch to /v1/search yourself. Same instance, same API token,
 * same data — just a different transport from MCP and ChatGPT Actions.
 */
export function GeminiSetup({
  gatewayBase,
  token,
  copied,
  onCopy,
}: {
  gatewayBase: string;
  token: string;
  copied: string | null;
  onCopy: CopyHandler;
}) {
  const t = token || '<YOUR_HOLO_TOKEN>';

  const pythonSnippet = `# pip install google-genai requests
import os, requests
from google import genai
from google.genai import types

HOLO_BASE = "${gatewayBase}"
HOLO_TOKEN = os.environ["HOLO_TOKEN"]  # paste from holo Settings → API keys

# 1. Declare holo_search as a Gemini function tool.
holo_search = types.FunctionDeclaration(
    name="holo_search",
    description="Search across the team's connected sources (Slack, GitHub, Notion, Grain, Pylon, HubSpot, Linear, Mintlify, Zendesk).",
    parameters=types.Schema(
        type="OBJECT",
        properties={
            "query": types.Schema(type="STRING", description="Natural-language search query."),
            "limit": types.Schema(type="INTEGER", description="Max results, default 5."),
        },
        required=["query"],
    ),
)

# 2. Dispatch a tool call to holo's REST endpoint.
def call_holo_search(args: dict) -> dict:
    r = requests.post(
        f"{HOLO_BASE}/v1/search",
        headers={"Authorization": f"Bearer {HOLO_TOKEN}", "Content-Type": "application/json"},
        json={"query": args["query"], "limit": args.get("limit", 5)},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

# 3. Run a Gemini turn with function calling enabled.
client = genai.Client()
chat = client.chats.create(
    model="gemini-2.5-pro",
    config=types.GenerateContentConfig(tools=[types.Tool(function_declarations=[holo_search])]),
)
response = chat.send_message("Find recent threads about onboarding flow.")
for part in response.candidates[0].content.parts:
    if part.function_call and part.function_call.name == "holo_search":
        result = call_holo_search(dict(part.function_call.args))
        chat.send_message(types.Part.from_function_response(name="holo_search", response=result))
print(chat.get_history()[-1].parts[0].text)
`;

  const tsSnippet = `// npm install @google/genai
import { GoogleGenAI, Type } from '@google/genai';

const HOLO_BASE = '${gatewayBase}';
const HOLO_TOKEN = process.env.HOLO_TOKEN!; // from holo Settings → API keys

const holoSearch = {
  name: 'holo_search',
  description:
    "Search across the team's connected sources (Slack, GitHub, Notion, Grain, Pylon, HubSpot, Linear, Mintlify, Zendesk).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'Natural-language search query.' },
      limit: { type: Type.INTEGER, description: 'Max results, default 5.' },
    },
    required: ['query'],
  },
};

async function callHoloSearch(args: { query: string; limit?: number }) {
  const r = await fetch(\`\${HOLO_BASE}/v1/search\`, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${HOLO_TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: args.query, limit: args.limit ?? 5 }),
  });
  if (!r.ok) throw new Error(\`holo \${r.status}\`);
  return r.json();
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const chat = ai.chats.create({
  model: 'gemini-2.5-pro',
  config: { tools: [{ functionDeclarations: [holoSearch] }] },
});

const first = await chat.sendMessage({ message: 'Find recent threads about onboarding flow.' });
const call = first.candidates?.[0]?.content?.parts?.find((p) => p.functionCall)?.functionCall;
if (call?.name === 'holo_search') {
  const result = await callHoloSearch(call.args as { query: string; limit?: number });
  await chat.sendMessage({
    message: [{ functionResponse: { name: 'holo_search', response: result } }],
  });
}
`;

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-6 text-text-muted">
        Gemini doesn&apos;t speak MCP natively. Wire it up by declaring a function tool whose
        schema matches holo&apos;s REST endpoint, then dispatch the tool call yourself. Same
        instance, same API key — just a different transport from the MCP path Claude / Cursor
        use.
      </p>

      <ol className="list-none space-y-4">
        <Step n={1}>
          Generate an API key in{' '}
          <a href="/settings" className="text-accent hover:underline">
            Settings → API keys
          </a>
          . Export it as <InlineCode>HOLO_TOKEN</InlineCode> in the environment your Gemini app
          runs in. {!token && <em className="text-text-subtle">No key generated yet — open Settings.</em>}
        </Step>

        <Step n={2}>
          Set <InlineCode>GEMINI_API_KEY</InlineCode> from{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Google AI Studio
          </a>{' '}
          (or use Vertex AI credentials).
        </Step>

        <Step n={3}>
          Python — declare the tool, dispatch on tool calls:
          <Snippet
            text={pythonSnippet.replace('<YOUR_HOLO_TOKEN>', t)}
            copyKey="gemini-python"
            copied={copied}
            onCopy={onCopy}
            language="python"
          />
        </Step>

        <Step n={4}>
          TypeScript — same pattern with <InlineCode>@google/genai</InlineCode>:
          <Snippet
            text={tsSnippet.replace('<YOUR_HOLO_TOKEN>', t)}
            copyKey="gemini-ts"
            copied={copied}
            onCopy={onCopy}
            language="typescript"
          />
        </Step>

        <Step n={5}>
          Both snippets call <InlineCode>POST /v1/search</InlineCode> on the same gateway as the
          MCP path — same chunks, same ACL, same audit log. Add more tools (
          <InlineCode>get_thread</InlineCode>, <InlineCode>get_pr</InlineCode>,{' '}
          <InlineCode>list_skills</InlineCode>, …) by mirroring the OpenAPI spec at{' '}
          <InlineCode>{gatewayBase}/openapi.json</InlineCode>.
        </Step>
      </ol>
    </div>
  );
}
