/* Notes Vault plugin — real markdown notes stored in the chat workspace (notes/). */
register({
  name: 'notes_write',
  description: 'Create or update a note in the user\'s notes vault (workspace folder notes/).',
  parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
  run: function (args) {
    var title = String(args.title || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'note';
    var path = 'notes/' + title.replace(/\.md$/, '') + '.md';
    var body = String(args.body || '');
    var out = Tools.run('write_file', { path: path, content: '# ' + title + '\n\n' + body + '\n' });
    return String(out).indexOf('Error') === 0 ? out : 'Saved note: ' + path;
  }
});
register({
  name: 'notes_read',
  description: 'Read a note from the vault by title.',
  parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  run: function (args) {
    var title = String(args.title || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return Tools.run('read_file', { path: 'notes/' + title.replace(/\.md$/, '') + '.md' });
  }
});
register({
  name: 'notes_list',
  description: 'List every note in the vault.',
  parameters: { type: 'object', properties: {} },
  run: function () {
    return Tools.run('list_files', { path: 'notes' });
  }
});
