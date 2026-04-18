from io import BytesIO
from pathlib import Path
import json, shutil, subprocess, threading, uuid, zipfile
from typing import Literal
import cairosvg
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image
from pillow_heif import register_heif_opener
register_heif_opener()
BASE_DIR=Path(__file__).resolve().parent
STATIC_DIR=BASE_DIR/"static"
DATA_ROOT=Path("/data")
LOCAL_TEMP_ROOT=Path("/local-temp")
SETTINGS_FILE=BASE_DIR/"settings.json"
SUPPORTED_INPUTS={"jpg","jpeg","jpe","jfif","png","webp","gif","bmp","dib","ico","tif","tiff","pbm","pgm","pnm","ppm","heic","heif","avif","svg"}
SUPPORTED_OUTPUTS={"same","webp","jpeg","png","gif","bmp","tiff"}
HEIF_FAMILY={"heic","heif","avif"}
JPEG_FAMILY={"jpg","jpeg","jpe","jfif"}
TIFF_FAMILY={"tif","tiff"}
DEFAULT_SETTINGS={"background_url":"https://images.example.com/cover.jpg","theme_style":"清透浅色","result_display":"JSON 原样显示","naming_strategy":"保留原名","carousel_interval":8,"background_blur":12}
app=FastAPI(title="Image Converter API")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])
app.mount("/assets",StaticFiles(directory=STATIC_DIR),name="assets")
class ConvertRequest(BaseModel):
    source_path:str=Field(min_length=1)
    output_path:str=Field(min_length=1)
    target_format:Literal["same","webp","jpeg","png","gif","bmp","tiff"]
    quality:int=Field(ge=1,le=100)
    input_formats:list[str]=Field(min_length=1)
    delete_original:bool=False
class WatchRequest(ConvertRequest):
    interval_seconds:int=Field(ge=3,le=86400)
    enabled:bool=True
class SettingsRequest(BaseModel):
    background_url:str=Field(min_length=1)
    theme_style:str=Field(min_length=1)
    result_display:str=Field(min_length=1)
    naming_strategy:str=Field(min_length=1)
    carousel_interval:int=Field(ge=1,le=3600)
    background_blur:int=Field(ge=0,le=50)
watch_state={"thread":None,"stop_event":None,"config":None,"seen":set()}
local_jobs={}
def ensure_dirs():
    DATA_ROOT.mkdir(parents=True,exist_ok=True); LOCAL_TEMP_ROOT.mkdir(parents=True,exist_ok=True)
def save_settings(settings:dict)->None:
    SETTINGS_FILE.write_text(json.dumps(settings,ensure_ascii=False,indent=2),encoding="utf-8")
def load_settings()->dict:
    if not SETTINGS_FILE.exists(): save_settings(DEFAULT_SETTINGS); return DEFAULT_SETTINGS.copy()
    try:data=json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception: save_settings(DEFAULT_SETTINGS); return DEFAULT_SETTINGS.copy()
    merged=DEFAULT_SETTINGS.copy(); merged.update({k:data.get(k,DEFAULT_SETTINGS[k]) for k in DEFAULT_SETTINGS}); return merged
def resolve_data_path(raw_path:str)->Path:
    ensure_dirs(); requested=raw_path.strip()
    if not requested: raise HTTPException(status_code=400,detail="路径不能为空")
    candidate=Path(requested)
    if not candidate.is_absolute(): candidate=DATA_ROOT/candidate
    try: resolved=candidate.resolve(strict=False); resolved.relative_to(DATA_ROOT.resolve())
    except ValueError as exc: raise HTTPException(status_code=400,detail="路径必须位于 /data 目录内") from exc
    return resolved
def to_display_path(path:Path)->str:
    root=DATA_ROOT.resolve(); resolved=path.resolve(strict=False)
    return "/data" if resolved==root else f"/data/{resolved.relative_to(root).as_posix()}"
def open_image(file_path:Path)->Image.Image:
    ext=file_path.suffix.lower().lstrip('.')
    if ext=="svg": return Image.open(BytesIO(cairosvg.svg2png(url=str(file_path))))
    return Image.open(file_path)
def normalize_target_format(source_ext:str,target_format:str)->str:
    if target_format!="same": return target_format
    if source_ext in JPEG_FAMILY: return "jpeg"
    if source_ext in TIFF_FAMILY: return "tiff"
    return source_ext if source_ext in SUPPORTED_OUTPUTS else "png"
def save_with_pillow(image:Image.Image,target_path:Path,target_format:str,quality:int)->None:
    if target_format=="jpeg": image.convert("RGB").save(target_path,"JPEG",quality=quality); return
    if target_format=="png": image.save(target_path,"PNG",optimize=True); return
    if target_format=="gif": image.convert("P",palette=Image.Palette.ADAPTIVE).save(target_path,"GIF"); return
    if target_format=="bmp": image.convert("RGB").save(target_path,"BMP"); return
    if target_format=="tiff": image.save(target_path,"TIFF"); return
    if target_format=="webp": image.save(target_path,"WEBP",quality=quality); return
    raise ValueError(f"不支持的目标格式: {target_format}")
def validate_formats(input_formats:list[str])->set[str]:
    normalized={fmt.lower().lstrip('.') for fmt in input_formats}; invalid=sorted(normalized-SUPPORTED_INPUTS)
    if invalid: raise HTTPException(status_code=400,detail=f"不支持的输入格式: {', '.join(invalid)}")
    return normalized
def convert_one_file(file_path:Path,source_dir:Path,output_dir:Path,target_format:str,quality:int):
    source_ext=file_path.suffix.lower().lstrip('.'); final_format=normalize_target_format(source_ext,target_format)
    relative_path=file_path.relative_to(source_dir); target_path=(output_dir/relative_path).with_suffix(f'.{final_format}'); target_path.parent.mkdir(parents=True,exist_ok=True)
    if final_format=='webp' and source_ext not in {"svg",*HEIF_FAMILY}: subprocess.run(['cwebp','-q',str(quality),str(file_path),'-o',str(target_path)],check=True,capture_output=True,text=True)
    else:
        with open_image(file_path) as image: save_with_pillow(image,target_path,final_format,quality)
    return target_path, final_format, relative_path
def convert_matching_images(request:ConvertRequest,only_new:bool=False)->dict:
    source_dir=resolve_data_path(request.source_path); output_dir=resolve_data_path(request.output_path)
    if not source_dir.exists() or not source_dir.is_dir(): raise HTTPException(status_code=400,detail="源目录不存在或不是目录")
    normalized_formats=validate_formats(request.input_formats); output_dir.mkdir(parents=True,exist_ok=True); converted=[]; skipped=[]; errors=[]
    for file_path in source_dir.rglob('*'):
        if not file_path.is_file(): continue
        source_ext=file_path.suffix.lower().lstrip('.')
        if source_ext not in normalized_formats: continue
        stat=file_path.stat(); display_source=to_display_path(file_path); marker=f"{display_source}:{int(stat.st_mtime)}:{stat.st_size}"
        if only_new and marker in watch_state["seen"]: continue
        try:
            target_path, final_format, _ = convert_one_file(file_path,source_dir,output_dir,request.target_format,request.quality)
            converted.append({'source':display_source,'output':to_display_path(target_path),'target_format':final_format})
            watch_state["seen"].add(marker)
            if request.delete_original: file_path.unlink(missing_ok=True)
        except Exception as exc: errors.append({'source':display_source,'error':str(exc)})
    if not converted and not errors: skipped.append('没有匹配到可转换的图片文件')
    return {'data_root':str(DATA_ROOT),'source_path':to_display_path(source_dir),'output_path':to_display_path(output_dir),'target_format':request.target_format,'quality':request.quality,'delete_original':request.delete_original,'converted_count':len(converted),'error_count':len(errors),'converted':converted,'skipped':skipped,'errors':errors}
def cleanup_local_job(job_id:str)->None:
    job=local_jobs.pop(job_id,None)
    if job: shutil.rmtree(job['root'],ignore_errors=True)
def stop_watch_worker()->None:
    stop_event=watch_state["stop_event"]; thread=watch_state["thread"]
    if stop_event is not None: stop_event.set()
    if thread is not None and thread.is_alive(): thread.join(timeout=1.5)
    watch_state["thread"]=None; watch_state["stop_event"]=None
def watch_worker(stop_event:threading.Event)->None:
    while not stop_event.is_set():
        config=watch_state["config"]
        if not config: break
        try: convert_matching_images(config,only_new=True)
        except Exception: pass
        stop_event.wait(config.interval_seconds)
@app.get("/")
def index(): return FileResponse(STATIC_DIR/"index.html")
@app.get("/health")
def health(): ensure_dirs(); return {"status":"ok","data_root":str(DATA_ROOT),"cwebp":shutil.which("cwebp") is not None,"inotifywait":shutil.which("inotifywait") is not None,"watch_running":bool(watch_state["thread"] and watch_state["thread"].is_alive()),"local_temp_root":str(LOCAL_TEMP_ROOT)}
@app.get("/folders")
def list_folders(path:str=Query(default="/data")):
    current_path=resolve_data_path(path)
    if not current_path.exists() or not current_path.is_dir(): raise HTTPException(status_code=404,detail="目录不存在")
    directories=sorted(item for item in current_path.iterdir() if item.is_dir()); parent=None
    if current_path.resolve()!=DATA_ROOT.resolve(): parent=to_display_path(current_path.parent)
    return {"current_path":to_display_path(current_path),"parent_path":parent,"directories":[{"name":item.name,"path":to_display_path(item)} for item in directories]}
@app.get("/settings")
def get_settings(): return load_settings()
@app.post("/settings")
def update_settings(request:SettingsRequest): settings=request.model_dump(); save_settings(settings); return settings
@app.post("/convert")
def convert_images(request:ConvertRequest): return convert_matching_images(request,only_new=False)
@app.post("/local/convert")
async def local_convert(files:list[UploadFile]=File(...),target_format:str=Form(...),quality:int=Form(...),input_formats:str=Form(...)):
    ensure_dirs(); formats=validate_formats([item for item in input_formats.split(',') if item]); job_id=uuid.uuid4().hex; job_root=LOCAL_TEMP_ROOT/job_id; input_dir=job_root/'input'; output_dir=job_root/'output'; zip_path=job_root/'converted-images.zip'; input_dir.mkdir(parents=True,exist_ok=True); output_dir.mkdir(parents=True,exist_ok=True)
    saved_count=0
    for upload in files:
        filename=Path(upload.filename or '').name
        if not filename: continue
        ext=Path(filename).suffix.lower().lstrip('.')
        if ext not in formats: continue
        (input_dir/filename).write_bytes(await upload.read()); saved_count+=1
    if not saved_count: shutil.rmtree(job_root,ignore_errors=True); raise HTTPException(status_code=400,detail='没有可转换的本地图片文件')
    converted=[]; errors=[]
    for file_path in input_dir.rglob('*'):
        if not file_path.is_file(): continue
        try:
            target_path, final_format, relative_path = convert_one_file(file_path,input_dir,output_dir,target_format,quality)
            converted.append({'source':str(relative_path).replace('\\','/'),'output':target_path.name,'target_format':final_format})
        except Exception as exc: errors.append({'source':file_path.name,'error':str(exc)})
    if not converted: shutil.rmtree(job_root,ignore_errors=True); raise HTTPException(status_code=400,detail='本地图片转换失败')
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as archive:
        for output_file in output_dir.rglob('*'):
            if output_file.is_file(): archive.write(output_file,output_file.relative_to(output_dir))
    local_jobs[job_id]={'root':job_root,'zip_path':zip_path}
    return {'job_id':job_id,'converted_count':len(converted),'error_count':len(errors),'converted':converted,'errors':errors,'download_url':f'/local/download/{job_id}'}
@app.get('/local/download/{job_id}')
def local_download(job_id:str, background_tasks:BackgroundTasks):
    job=local_jobs.get(job_id)
    if not job or not job['zip_path'].exists(): raise HTTPException(status_code=404,detail='下载文件不存在或已清理')
    background_tasks.add_task(cleanup_local_job,job_id)
    return FileResponse(job['zip_path'],filename='converted-images.zip',media_type='application/zip',background=background_tasks)
@app.post("/watch")
def configure_watch(request:WatchRequest):
    resolve_data_path(request.source_path); resolve_data_path(request.output_path); stop_watch_worker(); watch_state["config"]=request; watch_state["seen"]=set()
    if request.enabled:
        stop_event=threading.Event(); thread=threading.Thread(target=watch_worker,args=(stop_event,),daemon=True); watch_state["stop_event"]=stop_event; watch_state["thread"]=thread; thread.start()
    return {"enabled":request.enabled,"watch_running":bool(watch_state["thread"] and watch_state["thread"].is_alive()),"source_path":request.source_path,"output_path":request.output_path,"interval_seconds":request.interval_seconds,"target_format":request.target_format,"input_formats":request.input_formats,"delete_original":request.delete_original}
