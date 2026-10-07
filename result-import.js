const MAX_FILE=2*1024*1024,MAX_TOTAL=10*1024*1024;
const decoder=new TextDecoder('utf-8',{fatal:true});

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}

// Read the directory before extracting, and bound streamed decompression output.
export async function readResultZip(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length>20*1024*1024)throw new Error('ZIP은 20MB 이하만 사용할 수 있습니다.');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break}
  if(end<0)throw new Error('올바른 ZIP 파일이 아닙니다.');
  const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||count>128||!count||offset+directorySize!==end)throw new Error('이 ZIP 구조는 지원하지 않습니다. 일반 ZIP으로 다시 압축해 주세요.');
  let pos=offset,total=0;const entries=[],seen=new Set();
  for(let i=0;i<count;i++){
    if(pos+46>end||view.getUint32(pos,true)!==0x02014b50)throw new Error('ZIP 목록이 손상되었습니다.');
    const flags=view.getUint16(pos+8,true),method=view.getUint16(pos+10,true),crc=view.getUint32(pos+16,true),size=view.getUint32(pos+24,true),compressed=view.getUint32(pos+20,true),nameLength=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),local=view.getUint32(pos+42,true);
    if(pos+46+nameLength+extra+comment>end)throw new Error('ZIP 항목이 손상되었습니다.');
    const path=decoder.decode(bytes.subarray(pos+46,pos+46+nameLength)).replaceAll('\\','/');
    if(!path||path.startsWith('/')||path.includes(':')||path.includes('\0')||path.split('/').some(x=>x==='..'||x==='.'))throw new Error('안전하지 않은 파일 경로가 포함되어 있습니다.');
    if(seen.has(path))throw new Error('중복 파일 경로가 있습니다.');seen.add(path);
    if(flags&1||![0,8].includes(method)||size>MAX_FILE||((view.getUint32(pos+38,true)>>>16)&0xf000)===0xa000)throw new Error('암호화·특수 파일 또는 너무 큰 파일이 포함되어 있습니다.');
    total+=size;if(total>MAX_TOTAL)throw new Error('압축 해제 크기가 10MB를 초과합니다.');
    entries.push({path,flags,method,crc,size,compressed,local});pos+=46+nameLength+extra+comment;
  }
  if(pos!==end)throw new Error('ZIP 목록 크기가 일치하지 않습니다.');
  const regular=entries.filter(x=>!x.path.endsWith('/'));
  if(!regular.length)throw new Error('ZIP에 파일이 없습니다.');
  const first=regular[0].path.split('/')[0];
  const root=regular.every(x=>x.path.startsWith(first+'/'))?first+'/':'';
  const files=[];
  for(const entry of entries){
    if(entry.path.endsWith('/'))continue;
    const path=entry.path.startsWith(root)?entry.path.slice(root.length):entry.path;
    const at=entry.local;
    if(at+30>offset||view.getUint32(at,true)!==0x04034b50||view.getUint16(at+8,true)!==entry.method||view.getUint16(at+6,true)!==entry.flags)throw new Error('ZIP 파일 헤더가 손상되었습니다.');
    const n=view.getUint16(at+26,true),x=view.getUint16(at+28,true),start=at+30+n+x;
    if(start+entry.compressed>offset||decoder.decode(bytes.subarray(at+30,at+30+n)).replaceAll('\\','/')!==entry.path)throw new Error('ZIP 파일 위치가 올바르지 않습니다.');
    let output=bytes.subarray(start,start+entry.compressed);
    if(entry.method===8){
      let stream;try{stream=new Blob([output]).stream().pipeThrough(new DecompressionStream('deflate-raw'))}catch{throw new Error('현재 브라우저에서는 ZIP 해제를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요.')}
      const reader=stream.getReader(),chunks=[];let length=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>entry.size||length>MAX_FILE){await reader.cancel();throw new Error('압축 해제 크기가 선언된 크기를 초과했습니다.')}chunks.push(value)}}finally{reader.releaseLock()}
      output=new Uint8Array(length);let cursor=0;for(const chunk of chunks){output.set(chunk,cursor);cursor+=chunk.length}
    }
    if(output.length!==entry.size||crc32(output)!==entry.crc)throw new Error(`${path}: 파일 내용이 손상되었습니다.`);
    files.push({path,bytes:output,size:output.length});
  }
  return {files};
}

const recordKeys=['phases','tasks','documents','roadmap','logs','ideas','bugs','releases'];
const toBase64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text)};
function fileType(path){
  const extension=path.split('.').pop().toLowerCase();
  return ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',zip:'application/zip',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})[extension]||'text/plain';
}
export async function prepareResultPackage(file){
  const buffer=await file.arrayBuffer(),{files}=await readResultZip(buffer);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
  const updateId=`zip-${hash}`,manifestFile=files.find(x=>x.path==='mph-update.json');
  let manifest={};
  if(manifestFile){
    try{manifest=JSON.parse(decoder.decode(manifestFile.bytes))}catch{throw new Error('mph-update.json의 형식이 올바르지 않습니다.')}
    if(!manifest||manifest.schema!=='mph-update-v1')throw new Error('mph-update.json은 mph-update-v1 형식이어야 합니다.');
    for(const key of recordKeys)if(manifest[key]!==undefined&&(!Array.isArray(manifest[key])||manifest[key].some(x=>!x||typeof x!=='object'||typeof (key==='phases'?x.name:x.title)!=='string')))throw new Error(`mph-update.json의 ${key} 형식을 확인해 주세요.`);
    if(manifest.nextTask&&typeof manifest.nextTask.title!=='string')throw new Error('다음 작업 형식이 올바르지 않습니다.');
  }
  const pack={schema:'mph-update-v1',updateId};
  for(const key of recordKeys)pack[key]=manifest[key]||[];
  if(manifest.nextTask)pack.nextTask=manifest.nextTask;
  pack.documents=[...pack.documents,...files.map(item=>({
    sourceId:`${updateId}:file:${item.path}`,title:`${file.name} · ${item.path}`,
    detail:'개발 결과 ZIP에서 가져온 산출물',status:'완료',fileName:item.path.split('/').pop(),
    mimeType:fileType(item.path),size:item.size,contentBase64:toBase64(item.bytes)
  })),{sourceId:`${updateId}:archive`,title:file.name,detail:'개발 결과 원본 ZIP',status:'완료',fileName:file.name,mimeType:'application/zip',size:buffer.byteLength,contentBase64:toBase64(new Uint8Array(buffer))}];
  // Source files are evidence of delivery, not evidence that tasks or tests passed.
  return {pack,files:files.map(x=>({path:x.path,size:x.size})),hasManifest:Boolean(manifestFile),projectTitle:manifest.projectTitle||'',filename:file.name};
}

export async function openResultImport(file,{project,apply}){
  const dialog=document.createElement('dialog');dialog.className='result-import-dialog';
  dialog.innerHTML=`<form><div class="section-head"><h2>개발 결과 반영</h2><button type="button" data-close aria-label="닫기">×</button></div><p data-project></p><p data-file></p><p>ZIP 원본과 내부 파일을 현재 프로젝트의 문서에 보관하고 개발 일지를 추가합니다.</p><details open><summary>산출물 목록</summary><ul data-files></ul></details><p data-summary class="help"></p><label>개발 결과 요약<textarea name="summary" rows="3" placeholder="이번에 개발하거나 수정한 내용을 적어 주세요."></textarea></label><p data-status role="status" aria-live="polite"></p><div class="modal-actions"><button type="button" data-close class="soft">닫기</button><button type="submit" class="primary" disabled>현재 프로젝트에 반영</button></div></form>`;
  document.body.append(dialog);
  const form=dialog.querySelector('form'),status=dialog.querySelector('[data-status]'),submit=form.querySelector('[type=submit]');
  dialog.querySelector('[data-project]').textContent=`반영할 프로젝트: ${project.title}`;dialog.querySelector('[data-file]').textContent=file.name;
  let prepared=null,working=false,closed=false;
  const close=()=>{if(working)return;closed=true;prepared=null;dialog.close();dialog.remove()};
  dialog.querySelectorAll('[data-close]').forEach(x=>x.onclick=close);dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.addEventListener('keydown',e=>e.stopPropagation());
  document.body.classList.remove('menu-open');dialog.showModal();status.textContent='ZIP 파일 확인 중…';
  try{
    const result=await prepareResultPackage(file);if(closed)return;prepared=result;
    for(const item of prepared.files){const li=document.createElement('li');li.textContent=`${item.path} (${Math.ceil(item.size/1024)} KB)`;dialog.querySelector('[data-files]').append(li)}
    const pack=prepared.pack;
    dialog.querySelector('[data-summary]').textContent=prepared.hasManifest?`함께 반영할 기록: 작업 ${pack.tasks.length}개 · 단계 ${pack.phases.length}개 · 일지 ${pack.logs.length}개 · 기타 ${pack.roadmap.length+pack.ideas.length+pack.bugs.length+pack.releases.length}개${pack.nextTask?' · 다음 작업 1개':''}${prepared.projectTitle&&prepared.projectTitle!==project.title?` (파일의 프로젝트명: ${prepared.projectTitle})`:''}`:'작업·진행률 변경 정보가 없는 ZIP입니다. 산출물과 반영 일지를 등록합니다.';
    status.textContent=`문서 ${pack.documents.length}개를 등록할 준비가 되었습니다.`;submit.disabled=false;
  }catch(error){status.textContent=error.message;return}
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(working||!prepared)return;working=true;
    const pack=structuredClone(prepared.pack),summary=form.elements.summary.value.trim();
    pack.logs.push({sourceId:`${pack.updateId}:import-log`,title:`개발 결과 반영: ${file.name}`,detail:summary||`ZIP 원본과 산출물 ${prepared.files.length}개를 등록했습니다.`,date:new Date().toLocaleDateString('ko-KR')});
    form.querySelectorAll('button,textarea').forEach(x=>x.disabled=true);status.textContent='산출물을 저장하고 있습니다…';
    try{
      const result=await apply(pack);
      if(result?.status==='duplicate')status.textContent='이미 이 프로젝트에 반영한 ZIP입니다.';
      else if(result?.status==='pending')status.textContent='현재 프로젝트에 반영했습니다. 클라우드 저장은 대기 중이며 저장 상태에서 재시도할 수 있습니다.';
      else status.textContent='현재 프로젝트에 개발 결과를 반영하고 저장했습니다.';
      prepared=null;
    }catch(error){status.textContent=error.message||'반영에 실패했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'}
    finally{working=false;form.querySelectorAll('button,textarea').forEach(x=>x.disabled=false);submit.disabled=!prepared}
  });
}
