import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { transformDoc } from '../scripts/docs-transform.mjs'

const routes = new Map([
  ['docs/user/cli/overview.md', 'docs/cli/overview'],
  ['docs/user/telemetry.md', 'docs/telemetry'],
  ['docs/reference/orchestrator-game.md', 'docs/orchestrator/orca-game']
])
const opts = { base: '/orca-oss', repoUrl: 'https://github.com/o/r', routes }

describe('transformDoc', () => {
  it('turns the H1 into frontmatter and drops it from the body', () => {
    const out = transformDoc(
      '# Usage tracking\n\nBody.\n',
      'docs/user/agents/usage-tracking.md',
      opts
    )
    assert.match(
      out.markdown,
      /^---\ntitle: "Usage tracking"\neditUrl: "https:\/\/github.com\/o\/r\/edit\/main\/docs\/user\/agents\/usage-tracking.md"\n---\n/
    )
    assert.doesNotMatch(out.markdown, /^# Usage tracking/m)
  })

  it('rewrites links to copied docs onto the site, keeping the anchor', () => {
    const out = transformDoc(
      '# T\n\nSee [CLI](../cli/overview.md#flags) and [privacy](../telemetry.md).\n',
      'docs/user/agents/supported.md',
      opts
    )
    assert.match(out.markdown, /\[CLI\]\(\/orca-oss\/docs\/cli\/overview\/#flags\)/)
    assert.match(out.markdown, /\[privacy\]\(\/orca-oss\/docs\/telemetry\/\)/)
  })

  it('sends links to repo files that are not on the site to GitHub', () => {
    const out = transformDoc(
      '# T\n\n[code](../../src/main/index.ts) and [dir](../../examples/plugins/worklog) and [glibc](./linux-glibc-compatibility.md)\n',
      'docs/reference/plugin-development.md',
      opts
    )
    assert.match(out.markdown, /\(https:\/\/github.com\/o\/r\/blob\/main\/src\/main\/index.ts\)/)
    assert.match(
      out.markdown,
      /\(https:\/\/github.com\/o\/r\/blob\/main\/examples\/plugins\/worklog\)/
    )
    assert.match(
      out.markdown,
      /\(https:\/\/github.com\/o\/r\/blob\/main\/docs\/reference\/linux-glibc-compatibility.md\)/
    )
  })

  it('leaves external links, anchors and code untouched', () => {
    const src =
      '# T\n\n[a](https://x.dev) [b](#here) `[c](d.md)`\n\n```md\n[e](../f.md) <scene>\n```\n'
    const out = transformDoc(src, 'docs/user/ssh.md', opts)
    assert.match(out.markdown, /\[a\]\(https:\/\/x.dev\) \[b\]\(#here\) `\[c\]\(d.md\)`/)
    assert.match(out.markdown, /```md\n\[e\]\(\.\.\/f.md\) <scene>\n```/)
  })

  it('escapes placeholder tags in prose so they are not swallowed as HTML', () => {
    const out = transformDoc(
      '# T\n\n**Create from <scene>** keeps <br/> and <kbd>K</kbd>.\n',
      'docs/user/ssh.md',
      opts
    )
    assert.match(out.markdown, /Create from &lt;scene&gt;/)
    assert.match(out.markdown, /<br\/> and <kbd>K<\/kbd>/)
  })

  it('collects image paths so the caller can copy them into public/', () => {
    const out = transformDoc(
      '# T\n\n![grid](../../docs/assets/readme/agent-grid.gif)\n',
      'docs/user/terminal.md',
      opts
    )
    assert.deepEqual(out.images, ['docs/assets/readme/agent-grid.gif'])
    assert.match(
      out.markdown,
      /!\[grid\]\(\/orca-oss\/media\/docs\/assets\/readme\/agent-grid.gif\)/
    )
  })
})
