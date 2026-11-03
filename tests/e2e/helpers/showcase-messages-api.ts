import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// A local stand-in for the Messages API so a recorded lead streams a scripted answer
// instead of an API error; nothing leaves the machine.
export type ScriptedReply = { match: RegExp; text: string }

export type MessagesApi = {
  url: string
  /** Prompts the lead's Claude sent, oldest first. */
  prompts: string[]
  close: () => Promise<void>
}

const CHUNK_MS = 35

function lastUserText(body: unknown): string {
  const messages = (body as { messages?: { role: string; content: unknown }[] }).messages ?? []
  const last = messages.findLast((message) => message.role === 'user')
  if (!last) {
    return ''
  }
  if (typeof last.content === 'string') {
    return last.content
  }
  return (last.content as { type: string; text?: string }[])
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('\n')
}

const sse = (res: ServerResponse, event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

async function streamText(res: ServerResponse, model: string, text: string): Promise<void> {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_showcase_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1 }
    }
  })
  sse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' }
  })
  // Why words: a streamed answer is what the owner sees in a real lead.
  for (const word of text.match(/\S+\s*/g) ?? []) {
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: word }
    })
    await new Promise((resolve) => setTimeout(resolve, CHUNK_MS))
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 80 }
  })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export async function startMessagesApi(replies: ScriptedReply[]): Promise<MessagesApi> {
  const prompts: string[] = []
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' }).end('{}')
      return
    }
    const body = (await readBody(req)) as { stream?: boolean; model?: string }
    if (req.url.startsWith('/v1/messages/count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":1200}')
      return
    }
    const prompt = lastUserText(body)
    const reply = replies.find((one) => one.match.test(prompt))
    // Why only matched prompts are recorded: Claude also sends side requests (titles, topics).
    if (reply) {
      prompts.push(prompt)
    }
    const text = reply?.text ?? 'OK.'
    const model = body.model ?? 'claude-opus-5-5'
    if (body.stream) {
      await streamText(res, model, text)
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        id: `msg_showcase_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1200, output_tokens: 80 }
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    prompts,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
