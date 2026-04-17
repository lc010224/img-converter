from pathlib import Path
import shutil
import subprocess
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image

app = FastAPI(title="Image Converter API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED_INPUTS = {"jpg", "jpeg", "png", "webp"}
SUPPORTED_OUTPUTS = {"webp", "jpeg", "png"}


class ConvertRequest(BaseModel):
    source_path: str = Field(min_length=1)
    output_path: str = Field(min_length=1)
    target_format: Literal["webp", "jpeg", "png"]
    quality: int = Field(ge=1, le=100)
    input_formats: list[str] = Field(min_length=1)
    delete_original: bool = False


@app.get("/health")
def health():
    return {
        "status": "ok",
        "cwebp": shutil.which("cwebp") is not None,
        "inotifywait": shutil.which("inotifywait") is not None,
    }


@app.post("/convert")
def convert_images(request: ConvertRequest):
    source_dir = Path(request.source_path)
    output_dir = Path(request.output_path)

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
                'source': str(file_path),
                'output': str(target_path),
            })

            if request.delete_original:
                file_path.unlink()
        except Exception as exc:
            errors.append({
                'source': str(file_path),
                'error': str(exc),
            })

    if not converted and not errors:
        skipped.append('没有匹配到可转换的图片文件')

    return {
        'source_path': str(source_dir),
        'output_path': str(output_dir),
        'target_format': request.target_format,
        'quality': request.quality,
        'delete_original': request.delete_original,
        'converted_count': len(converted),
        'error_count': len(errors),
        'converted': converted,
        'skipped': skipped,
        'errors': errors,
    }
