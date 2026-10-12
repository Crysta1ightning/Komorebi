from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

source = Path('dist-mobile')
if not (source / 'index.html').exists():
    raise SystemExit('Run npm run build:mobile first.')
output = Path('artifacts/mobile/komorebi-mobile.zip')
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
    for path in sorted(source.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(source))
print(f'{output}: {output.stat().st_size / 1024 / 1024:.1f} MB')
