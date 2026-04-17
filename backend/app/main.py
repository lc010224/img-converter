from pathlib import Path
import shutil
import subprocess
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_ROOT = Path("/data")
SUPPORTED_INPUTS = {"jpg", "jpeg", "png", "webp"}
SUPPORTED_OUTPUTS = {"webp", "jpeg", "png"}

app = FastAPI(title="Image Converter API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")


class ConvertRequest(BaseModel):
    source_path: str = Field(min_length=1)
    output_path: str = Field(min_length=1)
    target_format: Literal["webp", "jpeg", "png"]
    quality: int = Field(ge=1, le=100)
    input_formats: list[str] = Field(min_length=1)
    delete_original: bool = False


def ensure_data_root() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)


def resolve_data_path(raw_path: str) -> Path:
    ensure_data_root()
    requested = raw_path.strip()
    if not requested:
        raise HTTPException(status_code=400, detail="路径不能为空")

    candidate = Path(requested)
    if not candidate.is_absolute():
        candidate = DATA_ROOT / candidate

    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(DATA_ROOT.resolve())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="路径必须位于 /data 目录内") from exc

    return resolved


def to_display_path(path: Path) -> str:
    root = DATA_ROOT.resolve()
    resolved = path.resolve(strict=False)
    if resolved == root:
        return "/data"
    return f"/data/{resolved.relative_to(root).as_posix()}"


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def health():
    ensure_data_root()
    return {
        "status": "ok",
        "data_root": str(DATA_ROOT),
        "cwebp": shutil.which("cwebp") is not None,
        "inotifywait": shutil.which("inotifywait") is not None,
    }


@app.get("/folders")
def list_folders(path: str = Query(default="/data")):
    current_path = resolve_data_path(path)
    if not current_path.exists() or not current_path.is_dir():
        raise HTTPException(status_code=404, detail="目录不存在")

    directories = sorted(item for item in current_path.iterdir() if item.is_dir())
    parent = None
    if current_path.resolve() != DATA_ROOT.resolve():
        parent = to_display_path(current_path.parent)

    return {
        "current_path": to_display_path(current_path),
        "parent_path": parent,
        "directories": [
            {
                "name": item.name,
                "path": to_display_path(item),
            }
            for item in directories
        ],
    }


@app.post("/convert")
def convert_images(request: ConvertRequest):
    source_dir = resolve_data_path(request.source_path)
    output_dir = resolve_data_path(request.output_path)

    if not source_dir.exists() or not source_dir.is_dir():
        raise HTTPException(status_code=400, detail="源目录不存在或不是目录")

    normalized_formats = {fmt.lower().lstrip('.') for fmt in request.input_formats}
    invalid_formats = sorted(normalized_formats - SUPPORTED_INPUTS)
    if invalid_formats:
        raise HTTPException(status_code=400, detail=f"不支持的输入格式: {', '.join(invalid_formats)}")

    output_dir.mkdir(parents=True, exist_ok=True)

    converted = []
    skipped = []
    errors = []

    for file_path in source_dir.rglob('*'):
        if not file_path.is_file():
            continue

        ext = file_path.suffix.lower().lstrip('.')
        if ext not in normalized_formats:
            continue

        relative_path = file_path.relative_to(source_dir)
        target_path = (output_dir / relative_path).with_suffix(f'.{request.target_format}')
        target_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if request.target_format == 'webp':
                subprocess.run(
                    [
                        'cwebp',
                        '-q',
                        str(request.quality),
                        str(file_path),
                        '-o',
                        str(target_path),
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )
            else:
                with Image.open(file_path) as image:
                    working_image = image.convert('RGB') if request.target_format == 'jpeg' else image
                    save_format = 'JPEG' if request.target_format == 'jpeg' else 'PNG'
                    save_kwargs = {'quality': request.quality} if request.target_format == 'jpeg' else {'optimize': True}
                    working_image.save(target_path, save_format, **save_kwargs)

            converted.append({
                'source': to_display_path(file_path),
                'output': to_display_path(target_path),
            })

            if request.delete_original:
                file_path.unlink()
        except Exception as exc:
            errors.append({
                'source': to_display_path(file_path),
                'error': str(exc),
            })

    if not converted and not errors:
        skipped.append('没有匹配到可转换的图片文件')

    return {
        'data_root': str(DATA_ROOT),
        'source_path': to_display_path(source_dir),
        'output_path': to_display_path(output_dir),
        'target_format': request.target_format,
        'quality': request.quality,
        'delete_original': request.delete_original,
        'converted_count': len(converted),
        'error_count': len(errors),
        'converted': converted,
        'skipped': skipped,
        'errors': errors,
    }
