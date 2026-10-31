import re

with open('tinviewer.html', 'r', encoding='utf-8') as f:
    text = f.read()

lines = text.split('\n')

# Post-Vite-cutover shape: <style> and the single inlined module <script> both
# live inside <head>, followed by </head><body>...</body></html>. (The old,
# pre-Stage-2 shape had style in <head> and the whole app script inside <body>
# instead -- this script's line-slicing has to match the build output as it
# actually is, not that older assumption.)
style_open_idx = next(i for i, l in enumerate(lines) if l.lstrip().startswith('<style>'))
style_close_idx = next(i for i in range(style_open_idx, len(lines)) if '</style>' in lines[i])

script_open_idx = next(i for i in range(style_close_idx + 1, len(lines)) if '<script' in lines[i])
script_close_idx = next(i for i in range(script_open_idx, len(lines)) if lines[i].rstrip().endswith('</script>'))

head_close_idx = next(i for i in range(script_close_idx + 1, len(lines)) if '</head>' in lines[i])
body_open_idx = next(i for i in range(head_close_idx + 1, len(lines)) if lines[i].lstrip().startswith('<body'))
body_close_idx = next(i for i in range(body_open_idx + 1, len(lines)) if '</body>' in lines[i])

assert head_close_idx == script_close_idx + 1, f"expected head close right after script close, got {script_close_idx} {head_close_idx}"
assert body_open_idx == head_close_idx + 1, f"expected body open right after head close, got {head_close_idx} {body_open_idx}"

# title through the closing </script> tag -- covers <title>, the icon/font
# links, <style>, and the inlined module script. Relies on HTML5's implicit
# head/body inference (no explicit <html>/<head>/<body> wrapper needed): a
# browser opens an implied <head> for this leading metadata content, then
# implicitly closes it and opens <body> the moment real DOM content follows.
head_part = lines[5:script_close_idx + 1]
# body content, minus the <body>/</body> tags themselves
body_part = lines[body_open_idx + 1:body_close_idx]

out_lines = head_part + body_part
out_text = '\n'.join(out_lines) + '\n'

# The Artifact preview has no way to upload a DXF, so it would otherwise open
# blank -- auto-load the bundled sample terrain instead. The Vite build keeps
# loadSampleData() module-scoped (not on window), so a classic
# <script>loadSampleData();</script> throws ReferenceError; instead click the
# app's own "Load sample" button from a module script, which runs after the
# app's own (earlier, also module) script has wired that button up.
out_text += '<script type="module">document.getElementById(\'btn-sample\').click();</script>\n'

with open('tinviewer_artifact.html', 'w', encoding='utf-8') as f:
    f.write(out_text)

print('wrote', len(out_lines), 'lines +1 sample-loader line')
print('head_part first/last:', head_part[0][:80], '|', head_part[-1][-80:])
print('body_part first/last:', body_part[0][:80], '|', body_part[-1][-80:])
