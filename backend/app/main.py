from io import BytesIO
from pathlib import Path
import shutil
import subprocess
from typing import Literal

import cairosvg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image
from pillow_heif import register_heif_opener

register_heif_opener()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_ROOT = Path("/data")
SUPPORTED_INPUTS = {
    "jpg", "jpeg", "jpe", "jfif", "png", "webp", "gif", "bmp", "dib", "ico",
    "tif", "tiff", "pbm", "pgm", "pnm", "ppm", "heic", "heif", "avif", "svg",
}
SUPPORTED_OUTPUTS = {"same", "webp", "jpeg", "png", "gif", "bmp", "tiff"}
HEIF_FAMILY = {"heic", "heif", "avif"}
JPEG_FAMILY = {"jpg", "jpeg", "jpe", "jfif"}
TIFF_FAMILY = {"tif", "tiff"}

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
    target_format: Literal["same", "webp", "jpeg", "png", "gif", "bmp", "tiff"]
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


def open_image(file_path: Path) -> Image.Image:
    ext = file_path.suffix.lower().lstrip('.')
    if ext == "svg":
        png_bytes = cairosvg.svg2png(url=str(file_path))
        return Image.open(BytesIO(png_bytes))
    return Image.open(file_path)


def normalize_target_format(source_ext: str, target_format: str) -> str:
    if target_format != "same":
        return target_format
    if source_ext in JPEG_FAMILY:
        return "jpeg"
    if source_ext in TIFF_FAMILY:
        return "tiff"
    if source_ext in SUPPORTED_OUTPUTS:
        return source_ext
    return "png"


def save_with_pillow(image: Image.Image, target_path: Path, target_format: str, quality: int) -> None:
    if target_format == "jpeg":
        image.convert("RGB").save(target_path, "JPEG", quality=quality)
        return
    if target_format == "png":
        image.save(target_path, "PNG", optimize=True)
        return
    if target_format == "gif":
        image.convert("P", palette=Image.Palette.ADAPTIVE).save(target_path, "GIF")
        return
    if target_format == "bmp":
        image.convert("RGB").save(target_path, "BMP")
        return
    if target_format == "tiff":
        image.save(target_path, "TIFF")
        return
    if target_format == "webp":
        image.save(target_path, "WEBP", quality=quality)
        return
    raise ValueError(f"不支持的目标格式: {target_format}")


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
        "directories": [{"name": item.name, "path": to_display_path(item)} for item in directories],
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

    converted, skipped, errors = [], [], []

    for file_path in source_dir.rglob('*'):
        if not file_path.is_file():
            continue

        source_ext = file_path.suffix.lower().lstrip('.')
        if source_ext not in normalized_formats:
            continue

        final_format = normalize_target_format(source_ext, request.target_format)
        relative_path = file_path.relative_to(source_dir)
        target_path = (output_dir / relative_path).with_suffix(f'.{final_format}')
        target_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if final_format == 'webp' and source_ext not in {"svg", *HEIF_FAMILY}:
                subprocess.run([
                    'cwebp', '-q', str(request.quality), str(file_path), '-o', str(target_path),
                ], check=True, capture_output=True, text=True)
            else:
                with open_image(file_path) as image:
                    save_with_pillow(image, target_path, final_format, request.quality)

            converted.append({
                'source': to_display_path(file_path),
                'output': to_display_path(target_path),
                'target_format': final_format,
            })

            if request.delete_original and target_path != file_path:
                file_path.unlink()
        except Exception as exc:
            errors.append({'source': to_display_path(file_path), 'error': str(exc)})

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
