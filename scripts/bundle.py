# 将 icost-pwa 打包为单个自包含 HTML（CSS + 全部 ES 模块内联，零外部请求）
import os, re, posixpath, html as html_mod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'js')

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def mod_id(rel):            # js/pages/home.js -> pages/home
    r = rel.replace('js/', '', 1) if rel.startswith('js/') else rel
    return r[:-3] if r.endswith('.js') else r

def resolve(spec, from_id):  # 解析 import 说明符为模块 id
    if not spec.startswith('.'):
        return spec
    base = posixpath.dirname(from_id)
    p = posixpath.normpath(posixpath.join(base, spec))
    return p[:-3] if p.endswith('.js') else p

def collect(files):
    mods = {}
    for path in files:
        rel = os.path.relpath(path, ROOT).replace('\\', '/')
        mods[mod_id(rel)] = read(path)
    return mods

# ---------- 转换单个模块 ----------
IMPORT_RE = re.compile(
    r"^[ \t]*import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\})?\s*([\w$]+)?\s*from\s*['\"]([^'\"]+)['\"];?[ \t]*$",
    re.M)
DYN_RE = re.compile(r"import\(['\"](\./[^'\"]*pages/index\.js)['\"]\)")
# 其余相对动态 import（如 import('./store.js')）在单文件包里也必须落到 __req 上
DYN_ANY_RE = re.compile(r"import\(['\"](\.[^'\"]+\.js)['\"]\)")
EXPORT_DEFAULT_RE = re.compile(r"^[ \t]*export\s+default\s+(.+?);?[ \t]*$", re.M)
EXPORT_NAMED_RE = re.compile(r"^[ \t]*export\s+(const|let|var|async\s+function|function|class)\s+([\w$]+)", re.M)
EXPORT_LIST_RE = re.compile(r"^[ \t]*export\s*\{([^}]*)\};?[ \t]*$", re.M)

def rewrite_default_export(src):
    """export default 可能是多行对象字面量，用括号匹配整块替换"""
    out = src
    while True:
        m = re.search(r"(?m)^[ \t]*export\s+default\s+", out)
        if not m:
            return out
        start = m.end()
        ch = out[start]
        if ch in '{[(':
            close = {'{': '}', '[': ']', '(': ')'}[ch]
            depth, i = 0, start
            while i < len(out):
                if out[i] in '{[(':
                    depth += 1
                elif out[i] in '}])':
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            end = i + 1
            tail = out[end:].lstrip()
            end += len(out[end:]) - len(tail)
            if tail.startswith(';'):
                end += 1
            block = out[start:end].rstrip().rstrip(';')
            out = out[:m.start()] + "__exports.default = " + block + ";" + out[end:]
        else:
            line_end = out.find('\n', start)
            if line_end < 0:
                line_end = len(out)
            expr = out[start:line_end].rstrip().rstrip(';')
            out = out[:m.start()] + "__exports.default = " + expr + ";" + out[line_end:]

def transform(mid, src):
    names = []

    def imp(m):
        default, named, default2, spec = m.groups()
        default = default or default2
        tid = resolve(spec, mid)
        out = []
        if default:
            out.append(f"const {default} = __req({tid!r}).default;")
        if named and named.strip():
            out.append(f"const {{ {named.strip()} }} = __req({tid!r});")
        return "\n".join(out) if out else ""

    src = IMPORT_RE.sub(imp, src)
    src = DYN_RE.sub("__loadPages()", src)
    src = DYN_ANY_RE.sub(lambda m: f"Promise.resolve().then(() => __req({resolve(m.group(1), mid)!r}))", src)
    src = EXPORT_LIST_RE.sub(lambda m: "Object.assign(__exports, {%s});" % m.group(1).strip(), src)
    src = rewrite_default_export(src)

    def named(m):
        names.append(m.group(2))
        return f"{m.group(1)} {m.group(2)}"
    src = EXPORT_NAMED_RE.sub(named, src)

    body = "__exports" if False else ""
    assigns = "\n".join(f"__exports.{n} = {n};" for n in dict.fromkeys(names))
    return f"""function(__req) {{
  const __exports = {{}};
{src}
{assigns}
  return __exports;
}}"""

def module_list():
    """从 js/modules.js 读模块清单 —— 与 sw.js 共用同一份数据源，别在别处再抄一份"""
    src = read(os.path.join(JS, 'modules.js'))
    def block(name):
        m = re.search(r'export const %s = \[(.*?)\]' % name, src, re.S)
        if not m:
            raise SystemExit('modules.js 里找不到 %s' % name)
        return re.findall(r"'([^']+)'", m.group(1))
    return block('JS_CORE'), block('PAGE_NAMES')

def main():
    core, pages = module_list()
    files = [os.path.join(JS, os.path.basename(c)) for c in core]
    files += [os.path.join(JS, 'pages', p + '.js') for p in pages]

    mods = collect(files)
    order = list(mods.keys())

    parts = []
    for mid in order:
        parts.append(f"__mods[{mid!r}] = {transform(mid, mods[mid])};")
    registry = "\n".join(parts)

    css = read(os.path.join(ROOT, 'css', 'style.css'))
    idx = read(os.path.join(ROOT, 'index.html'))

    bundle = f"""<script>
(function() {{
  function __boot() {{
  const __mods = {{}};
  const __cache = {{}};
  const __req = (id) => __cache[id] || (__cache[id] = __mods[id](__req));
  const __loadPages = () => Promise.resolve().then(() => __req('pages/index'));
{registry}
  try {{ __req('app'); }} catch (e) {{ console.error(e); }}
  }}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', __boot);
  else __boot();
}})();
</script>"""

    out = idx.replace('<link rel="stylesheet" href="css/style.css">', f'<style>\n{css}\n</style>')
    out = out.replace('<script type="module" src="js/app.js"></script>', bundle)
    out = out.replace('<link rel="manifest" href="manifest.json">', '')
    out = out.replace('<link rel="apple-touch-icon" href="assets/icon-180.png">', '')
    out = out.replace('<link rel="icon" type="image/png" href="assets/icon-192.png">', '')
    out = out.replace('<title>iCost 记账</title>', '<title>iCost 记账</title>\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')

    dist = os.path.join(ROOT, 'dist')
    os.makedirs(dist, exist_ok=True)
    target = os.path.join(dist, 'iCost-记账.html')
    with open(target, 'w', encoding='utf-8') as f:
        f.write(out)
    print('BUILT', target, os.path.getsize(target) // 1024, 'KB', '| modules:', len(order))

if __name__ == '__main__':
    main()
