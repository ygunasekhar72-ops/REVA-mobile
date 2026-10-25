/* Mono Harness — plugin registry
   A plugin pack ships an instruction block that is injected into the system
   prompt while it is installed and enabled. Add an entry here to publish a
   plugin to every instance of the app. */
(function () {
  window.REGISTRY = [
    {
      id: 'code-reviewer', n: 'Code Reviewer', v: '1.0.0', by: 'Mono Harness', i: 'git-pull-request',
      d: 'Review-focused code habits', featured: true,
      prompt: 'When reviewing or writing code: check edge cases, error handling, security and performance. Name the riskiest part of a change first, then the fix.'
    },
    {
      id: 'mermaid-charts', n: 'Mermaid Charts', v: '1.0.0', by: 'Mono Harness', i: 'workflow',
      d: 'Explain structure visually',
      prompt: 'When explaining architecture, data flow, or state machines, include a diagram in a ```mermaid fenced block alongside the prose.'
    },
    {
      id: 'sql-assistant', n: 'SQL Assistant', v: '1.0.0', by: 'Mono Harness', i: 'database',
      d: 'Careful, explicit SQL',
      prompt: 'For SQL: use explicit column lists, mention which columns should be indexed, and flag destructive statements (DELETE/UPDATE/DROP) before writing them.'
    },
    {
      id: 'regex-explainer', n: 'Regex Explainer', v: '1.0.0', by: 'Mono Harness', i: 'regex',
      d: 'Regex with breakdowns',
      prompt: 'When producing a regular expression, add a token-by-token breakdown and 3 example strings with their expected match results.'
    },
    {
      id: 'release-notes', n: 'Release Notes', v: '1.0.0', by: 'Mono Harness', i: 'scroll-text',
      d: 'Keep-a-changelog format',
      prompt: 'Format release notes with Added / Changed / Fixed / Removed headings; write exactly one bullet per user-facing change, no internal jargon.'
    },
    {
      id: 'prose-polisher', n: 'Prose Polisher', v: '1.0.0', by: 'Mono Harness', i: 'feather',
      d: 'Tighter, cleaner writing',
      prompt: 'When editing prose: shorter sentences, active voice, no filler words. Preserve the author\'s voice and existing formatting.'
    }
  ];
})();
