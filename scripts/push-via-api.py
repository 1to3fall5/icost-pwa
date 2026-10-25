#!/usr/bin/env python3
"""
git push 被环境代理挡住时的备用通道：走 GitHub Git Data API 建 commit + 移动 ref。

用法（仓库根目录）：
    python scripts/push-via-api.py                 # 推 HEAD（diff 相对 HEAD~1）
    python scripts/push-via-api.py <base> <head>   # 指定基线 / 目标 commit

前提：gh 已登录，且 gh api 能通（git 协议的 github.com 常常 502，但 api.github.com 通）。

两个坑（都踩过）：
  1. create-tree 的 content 要**明文**，写 base64 会把 base64 当文件内容存进仓库
     —— 2026-10-25 整个 css/style.css 变成一坨 base64，靠二次推送覆盖才救回来。
  2. 新增文件必须在 diff 里（git diff --name-only 能列出），否则远端会缺文件，
     CI 直接 ERR_MODULE_NOT_FOUND —— js/seticon.js 就是这么漏的。
"""
import json, subprocess, sys

REPO = '1to3fall5/icost-pwa'
BASE = sys.argv[1] if len(sys.argv) > 1 else 'HEAD~1'
HEAD = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'

def gh(args, payload=None):
    cmd = ['gh', 'api'] + args
    if payload is not None:
        cmd += ['--input', '-']
        p = subprocess.run(cmd, input=json.dumps(payload), capture_output=True, text=True, encoding='utf-8')
    else:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    if p.returncode != 0:
        print('gh 调用失败:', ' '.join(args), p.stderr[:400]); sys.exit(1)
    return json.loads(p.stdout)

def git(args, binary=False):
    p = subprocess.run(['git'] + args, capture_output=binary and None or True, text=not binary)
    if p.returncode != 0:
        print('git 失败:', ' '.join(args), p.stderr[:300]); sys.exit(1)
    return p.stdout

# 1) 远端 HEAD / tree
ref = gh(['repos/%s/git/ref/heads/main' % REPO])
remote_commit = ref['object']['sha']
rc = gh(['repos/%s/git/commits/%s' % (REPO, remote_commit)])
remote_tree = rc['tree']['sha']
print('远端 HEAD %s  tree %s' % (remote_commit[:8], remote_tree[:8]))
print('远端最新提交:', rc['message'].split('\n')[0][:70])

# 2) 远端完整 tree（path -> blob sha）
rt = gh(['repos/%s/git/trees/%s?recursive=1' % (REPO, remote_tree)])
remote_blobs = {i['path']: i['sha'] for i in rt['tree'] if i['type'] == 'blob'}

# 3) 本次改动的文件
files = git(['diff', '--name-only', BASE, HEAD]).split()
print('改动文件 %d 个' % len(files))

# 4) 基线校验：远端每个文件的 blob 应与本地 BASE 版本一致
bad = []
for f in files:
    try:
        local_base = git(['rev-parse', '%s:%s' % (BASE, f)]).strip()
    except SystemExit:
        local_base = None
    if local_base and f in remote_blobs and local_base != remote_blobs[f]:
        bad.append(f)
print('基线不一致的文件:', bad if bad else '无（可直接基于远端 tree 建 commit）')

# 5) 建 tree：内容取 git 对象里的规范字节（避免 CRLF 差异）
tree = []
for f in files:
    blob = subprocess.run(['git', 'cat-file', 'blob', '%s:%s' % (HEAD, f)], capture_output=True)
    if blob.returncode != 0:
        print('跳过（新 commit 里不存在）:', f); continue
    # 注意：create-tree 的 content 要明文，写 base64 会被当成文件内容存进去
    content = blob.stdout.decode('utf-8')
    tree.append({'path': f, 'mode': '100644', 'type': 'blob', 'content': content})
print('待写入 %d 个文件' % len(tree))

new_tree = gh(['-X', 'POST', 'repos/%s/git/trees' % REPO], {'base_tree': remote_tree, 'tree': tree})
print('新 tree %s' % new_tree['sha'][:8])

message = git(['log', '-1', '--format=%B', HEAD]).strip()
commit = gh(['-X', 'POST', 'repos/%s/git/commits' % REPO], {
    'message': message, 'tree': new_tree['sha'], 'parents': [remote_commit],
})
print('新 commit %s' % commit['sha'][:8])

upd = gh(['-X', 'PATCH', 'repos/%s/git/refs/heads/main' % REPO], {'sha': commit['sha'], 'force': False})
print('ref 已更新到', upd['object']['sha'][:8])
