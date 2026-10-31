/* REVA — IDE completion dictionaries (engine #7: language integrations, seed).
   Curated keyword + builtin tables for the IDE autocomplete core
   (js/idecore.js). One entry per language family the harness targets on
   mobile; every name here is a real token the language spec defines — this
   file is capability data, not filler. Extension-mapped, UMD. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IDEKEYWORDS = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  var js = {
    keywords: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'true', 'false', 'null', 'undefined'],
    builtins: ['Array', 'ArrayBuffer', 'Blob', 'Boolean', 'console', 'crypto', 'Date', 'document', 'Error', 'fetch', 'FormData', 'globalThis', 'Headers', 'Infinity', 'JSON', 'localStorage', 'Map', 'Math', 'NaN', 'navigator', 'Number', 'Object', 'performance', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'requestAnimationFrame', 'sessionStorage', 'Set', 'String', 'Symbol', 'URL', 'URLSearchParams', 'WeakMap', 'WeakSet', 'WebSocket', 'window', 'Worker', 'atob', 'btoa', 'clearInterval', 'clearTimeout', 'parseInt', 'parseFloat', 'setInterval', 'setTimeout', 'structuredClone']
  };

  var ts = {
    keywords: js.keywords.concat(['abstract', 'any', 'as', 'asserts', 'boolean', 'declare', 'enum', 'implements', 'infer', 'interface', 'is', 'keyof', 'namespace', 'never', 'number', 'object', 'override', 'private', 'protected', 'public', 'readonly', 'satisfies', 'string', 'symbol', 'type', 'unknown', 'unique']),
    builtins: js.builtins.concat(['Partial', 'Required', 'Readonly', 'Record', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'Parameters', 'ReturnType', 'Awaited'])
  };

  var html = {
    keywords: ['doctype', 'html', 'head', 'body', 'div', 'span', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'form', 'input', 'button', 'select', 'option', 'textarea', 'label', 'img', 'video', 'audio', 'source', 'canvas', 'svg', 'script', 'style', 'link', 'meta', 'title', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside', 'dialog', 'details', 'summary', 'template', 'slot', 'iframe', 'pre', 'code', 'blockquote', 'hr', 'br'],
    builtins: ['href', 'src', 'alt', 'class', 'id', 'type', 'name', 'value', 'placeholder', 'disabled', 'checked', 'selected', 'required', 'readonly', 'target', 'rel', 'action', 'method', 'for', 'content', 'charset', 'viewport', 'aria-label', 'aria-hidden', 'role', 'data-', 'onclick', 'onchange', 'onsubmit', 'onload', 'hidden', 'tabindex', 'width', 'height', 'loading', 'srcset', 'autoplay', 'controls', 'muted', 'poster']
  };

  var css = {
    keywords: ['@media', '@import', '@keyframes', '@font-face', '@supports', '@layer', '@container', '@property', '@page', 'important', 'from', 'to', 'and', 'or', 'not', 'only'],
    builtins: ['color', 'background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'border', 'border-radius', 'border-color', 'border-width', 'border-style', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'display', 'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap', 'row-gap', 'column-gap', 'justify-content', 'align-items', 'align-content', 'align-self', 'grid', 'grid-template-columns', 'grid-template-rows', 'grid-area', 'grid-column', 'grid-row', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'inset', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'text-overflow', 'text-shadow', 'white-space', 'word-break', 'overflow', 'overflow-x', 'overflow-y', 'opacity', 'visibility', 'cursor', 'pointer-events', 'user-select', 'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay', 'animation', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay', 'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'transform', 'transform-origin', 'translate', 'rotate', 'scale', 'skew', 'filter', 'backdrop-filter', 'box-shadow', 'outline', 'outline-offset', 'aspect-ratio', 'object-fit', 'object-position', 'content', 'list-style', 'direction', 'writing-mode', 'clip-path', 'mask', 'mix-blend-mode', 'isolation', 'resize', 'appearance', 'accent-color', 'color-scheme', 'scroll-behavior', 'scroll-snap-type', 'overscroll-behavior', 'touch-action', 'will-change', 'contain', 'container-type', 'float', 'clear', 'vertical-align', 'table-layout', 'border-collapse', 'border-spacing', 'caption-side', 'empty-cells', 'columns', 'column-count', 'column-width', 'break-inside', 'var', 'calc', 'min', 'max', 'clamp', 'attr', 'url', 'linear-gradient', 'radial-gradient', 'conic-gradient', 'rgba', 'rgb', 'hsl', 'hsla', 'inherit', 'initial', 'unset', 'revert']
  };

  var python = {
    keywords: ['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None', 'match', 'case'],
    builtins: ['abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'filter', 'float', 'format', 'frozenset', 'getattr', 'hasattr', 'hash', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 'max', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', 'os', 'sys', 'json', 're', 'math', 'random', 'datetime', 'time', 'pathlib', 'collections', 'itertools', 'functools', 'asyncio', 'typing', 'subprocess', 'shutil', 'threading', 'sqlite3', 'urllib', 'http', 'logging', 'unittest', 'argparse', 'dataclasses', 'enum', 'abc', 'copy', 'csv', 'hashlib', 'base64', 'uuid', 'secrets']
  };

  var java = {
    keywords: ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'var', 'record', 'sealed', 'permits', 'yield', 'true', 'false', 'null'],
    builtins: ['String', 'StringBuilder', 'StringBuffer', 'Object', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Character', 'Byte', 'Short', 'Math', 'System', 'Thread', 'Runnable', 'Exception', 'RuntimeException', 'Error', 'Throwable', 'Iterable', 'Comparable', 'Comparator', 'List', 'ArrayList', 'LinkedList', 'Map', 'HashMap', 'TreeMap', 'LinkedHashMap', 'Set', 'HashSet', 'TreeSet', 'LinkedHashSet', 'Queue', 'Deque', 'ArrayDeque', 'PriorityQueue', 'Optional', 'Stream', 'Collectors', 'Files', 'Paths', 'Path', 'IOException', 'LocalDate', 'LocalTime', 'LocalDateTime', 'Duration', 'Instant', 'ZoneId', 'Scanner', 'PrintStream', 'InputStream', 'OutputStream', 'Reader', 'Writer', 'Charset', 'Locale', 'Random', 'UUID', 'BigDecimal', 'BigInteger', 'Function', 'Supplier', 'Consumer', 'Predicate', 'BiFunction']
  };

  var c = {
    keywords: ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', '_Bool', '_Complex', '_Alignas', '_Alignof', '_Atomic', '_Static_assert', '_Thread_local', 'NULL', 'true', 'false'],
    builtins: ['printf', 'scanf', 'fprintf', 'fscanf', 'sprintf', 'snprintf', 'puts', 'gets', 'fgets', 'fputs', 'fopen', 'fclose', 'fread', 'fwrite', 'fseek', 'ftell', 'malloc', 'calloc', 'realloc', 'free', 'memcpy', 'memmove', 'memset', 'memcmp', 'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp', 'strchr', 'strstr', 'strdup', 'strtok', 'abs', 'labs', 'div', 'atoi', 'atol', 'strtol', 'strtod', 'rand', 'srand', 'exit', 'abort', 'assert', 'qsort', 'bsearch', 'time', 'clock', 'localtime', 'gmtime', 'strftime', 'math_h_sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'log10', 'pow', 'sqrt', 'fabs', 'floor', 'ceil', 'round', 'fmod']
  };

  var cpp = {
    keywords: c.keywords.concat(['alignas', 'alignof', 'catch', 'class', 'constexpr', 'const_cast', 'decltype', 'delete', 'dynamic_cast', 'explicit', 'export', 'friend', 'mutable', 'namespace', 'noexcept', 'nullptr', 'operator', 'private', 'protected', 'public', 'reinterpret_cast', 'requires', 'static_assert', 'static_cast', 'template', 'this', 'throw', 'try', 'typeid', 'typename', 'using', 'virtual', 'xor', 'concept', 'co_await', 'co_yield', 'co_return']),
    builtins: ['std', 'cout', 'cin', 'cerr', 'endl', 'string', 'vector', 'array', 'list', 'deque', 'map', 'unordered_map', 'set', 'unordered_set', 'multimap', 'multiset', 'queue', 'stack', 'priority_queue', 'pair', 'tuple', 'optional', 'variant', 'any', 'unique_ptr', 'shared_ptr', 'weak_ptr', 'make_unique', 'make_shared', 'function', 'bind', 'thread', 'mutex', 'lock_guard', 'unique_lock', 'atomic', 'condition_variable', 'future', 'promise', 'async', 'sort', 'find', 'find_if', 'transform', 'accumulate', 'for_each', 'copy', 'move', 'swap', 'max', 'min', 'max_element', 'min_element', 'reverse', 'count', 'count_if', 'unique', 'remove', 'remove_if', 'fill', 'generate', 'iota', 'reduce', 'minmax', 'clamp', 'exception', 'runtime_error', 'logic_error', 'out_of_range', 'invalid_argument', 'size_t', 'initializer_list', 'iterator', 'begin', 'end', 'data', 'size', 'empty', 'push_back', 'pop_back', 'emplace_back', 'insert', 'erase', 'clear', 'reserve', 'resize']
  };

  var go = {
    keywords: ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var', 'nil', 'true', 'false', 'iota'],
    builtins: ['append', 'cap', 'close', 'complex', 'copy', 'delete', 'imag', 'len', 'make', 'new', 'panic', 'print', 'println', 'real', 'recover', 'string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'byte', 'rune', 'float32', 'float64', 'complex64', 'complex128', 'bool', 'error', 'any', 'fmt', 'errors', 'os', 'io', 'bufio', 'strings', 'strconv', 'time', 'context', 'sync', 'sync_atomic', 'net_http', 'encoding_json', 'flag', 'log', 'math', 'rand', 'sort', 'bytes', 'reflect', 'testing', 'filepath']
  };

  var rust = {
    keywords: ['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'static', 'struct', 'super', 'trait', 'type', 'unsafe', 'use', 'where', 'while', 'true', 'false', 'Some', 'None', 'Ok', 'Err'],
    builtins: ['Vec', 'String', 'str', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'f32', 'f64', 'bool', 'char', 'Box', 'Rc', 'Arc', 'RefCell', 'Cell', 'Mutex', 'RwLock', 'HashMap', 'HashSet', 'BTreeMap', 'BTreeSet', 'VecDeque', 'BinaryHeap', 'Option', 'Result', 'Cow', 'slice', 'array', 'tuple', 'unit', 'Clone', 'Copy', 'Debug', 'Default', 'Display', 'PartialEq', 'Eq', 'PartialOrd', 'Ord', 'Hash', 'Iterator', 'IntoIterator', 'From', 'Into', 'TryFrom', 'TryInto', 'Send', 'Sync', 'Drop', 'Deref', 'Fn', 'FnMut', 'FnOnce', 'println', 'print', 'format', 'vec', 'panic', 'assert', 'assert_eq', 'assert_ne', 'todo', 'unimplemented', 'write', 'writeln', 'read_line', 'to_string', 'iter', 'map', 'filter', 'collect', 'fold', 'sum', 'zip', 'enumerate', 'rev', 'chain', 'take', 'skip']
  };

  var php = {
    keywords: ['abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'enum', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require', 'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield', 'true', 'false', 'null'],
    builtins: ['strlen', 'strcmp', 'strpos', 'str_replace', 'substr', 'trim', 'ltrim', 'rtrim', 'strtolower', 'strtoupper', 'ucfirst', 'implode', 'explode', 'join', 'sprintf', 'printf', 'number_format', 'htmlspecialchars', 'htmlentities', 'strip_tags', 'json_encode', 'json_decode', 'array_keys', 'array_values', 'array_merge', 'array_slice', 'array_map', 'array_filter', 'array_reduce', 'array_unique', 'array_reverse', 'in_array', 'array_search', 'count', 'sizeof', 'sort', 'usort', 'ksort', 'rsort', 'range', 'shuffle', 'array_push', 'array_pop', 'array_shift', 'array_unshift', 'var_dump', 'print_r', 'is_array', 'is_string', 'is_int', 'is_null', 'gettype', 'intval', 'strval', 'floatval', 'boolval', 'date', 'time', 'mktime', 'strtotime', 'microtime', 'file_get_contents', 'file_put_contents', 'fopen', 'fclose', 'fread', 'fwrite', 'file_exists', 'is_dir', 'mkdir', 'unlink', 'scandir', 'dirname', 'basename', 'pathinfo', 'copy', 'rename', 'md5', 'sha1', 'hash', 'base64_encode', 'base64_decode', 'urlencode', 'urldecode', 'curl_init', 'curl_exec', 'preg_match', 'preg_match_all', 'preg_replace', 'preg_split', 'str_repeat', 'nl2br', 'wordwrap', 'rand', 'mt_rand', 'max', 'min', 'abs', 'round', 'floor', 'ceil', 'sqrt', 'pow']
  };

  var sh = {
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'in', 'function', 'return', 'local', 'export', 'readonly', 'declare', 'unset', 'shift', 'break', 'continue', 'exit', 'trap', 'source', 'alias', 'set', 'eval', 'exec', 'echo', 'printf', 'read', 'test', 'cd', 'pwd', 'true', 'false', 'select', 'time', 'wait'],
    builtins: ['ls', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'find', 'which', 'whereis', 'chmod', 'chown', 'ln', 'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'curl', 'wget', 'ping', 'ssh', 'scp', 'rsync', 'ps', 'top', 'htop', 'kill', 'killall', 'jobs', 'fg', 'bg', 'nohup', 'df', 'du', 'free', 'uname', 'hostname', 'date', 'sleep', 'env', 'printenv', 'whoami', 'id', 'useradd', 'passwd', 'su', 'sudo', 'apt', 'apt-get', 'pkg', 'apk', 'git', 'node', 'npm', 'python', 'pip', 'vim', 'nano', 'diff', 'patch', 'xargs', 'tee', 'basename', 'dirname', 'realpath', 'md5sum', 'sha256sum', 'stat', 'file', 'seq', 'expr', 'bc', 'iconv', 'crontab', 'systemctl', 'service', 'mount', 'umount']
  };

  var MAP = {
    js: js, javascript: js, mjs: js, cjs: js, jsx: js,
    ts: ts, typescript: ts, tsx: ts,
    html: html, htm: html, xml: html, svg: html, vue: html,
    css: css, scss: css, sass: css, less: css,
    py: python, python: python,
    java: java, kt: java, kotlin: java, scala: java, cs: java, csharp: java,
    c: c, h: c,
    cpp: cpp, cc: cpp, cxx: cpp, hpp: cpp, hxx: cpp,
    go: go, golang: go,
    rs: rust, rust: rust,
    php: php,
    sh: sh, bash: sh, zsh: sh, sh_session: sh
  };

  function forExt(ext) {
    return MAP[String(ext || '').toLowerCase()] || js;
  }

  return { forExt: forExt, MAP: MAP };
});
