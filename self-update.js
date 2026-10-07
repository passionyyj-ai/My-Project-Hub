const MAX_FILE=2*1024*1024,MAX_TOTAL=10*1024*1024;
const ALLOWED=new Set(['index.html','app.js','workspace.js','self-update.js','styles.css','config.js','manifest.webmanifest','README_업로드방법.txt']);
const decoder=new TextDecoder('utf-8',{fatal:true});
const scriptTag='<script type="module" src="self-update.js"></script>';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}

// Read the directory before extracting, and bound streamed decompression output.
export async function readSourceZip(buffer){
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
  const roots=entries.filter(x=>x.path==='index.html'||x.path.endsWith('/index.html'));
  if(roots.length!==1)throw new Error('index.html이 하나 들어 있는 프로젝트 ZIP을 선택해 주세요.');
  const root=roots[0].path.slice(0,-'index.html'.length),files=[],skipped=[];
  for(const entry of entries){
    if(entry.path.endsWith('/'))continue;
    const path=entry.path.startsWith(root)?entry.path.slice(root.length):entry.path;
    if(!entry.path.startsWith(root)||!ALLOWED.has(path)||path==='config.js'){skipped.push(path);continue}
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
    files.push({path,content:decoder.decode(output),size:output.length});
  }
  for(const name of ['index.html','app.js','styles.css'])if(!files.some(x=>x.path===name))throw new Error(`${name}이 없는 소스 ZIP입니다.`);
  const index=files.find(x=>x.path==='index.html');
  if(!/<\/body\s*>/i.test(index.content))throw new Error('index.html에 body 종료 태그가 없습니다.');
  if(!files.some(x=>x.path==='workspace.js')&&files.find(x=>x.path==='app.js').content.includes('./workspace.js'))throw new Error('workspace.js가 빠져 있습니다.');
  // Older packages remain updatable after installation of this updater.
  if(!/<script\b[^>]*\bsrc\s*=\s*["'](?:\.\/)?self-update\.js["']/i.test(index.content))index.content=index.content.replace(/<\/body\s*>/i,`${scriptTag}\n</body>`);
  return {files,skipped};
}

export async function publishSource({owner,repo,branch,token,files,message,fetcher=fetch,onProgress=()=>{}}){
  if(!/^[a-zA-Z0-9-]+$/.test(owner)||! /^[a-zA-Z0-9_.-]+$/.test(repo)||!branch.trim()||!token.trim())throw new Error('저장소와 인증 정보를 입력해 주세요.');
  const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const request=async(path,method='GET',body)=>{
    const response=await fetcher(base+path,{method,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){const hint=response.status===401?'GitHub 인증 토큰을 확인해 주세요.':response.status===403?'토큰의 저장소 Contents 쓰기 권한 또는 브랜치 보호 설정을 확인해 주세요.':response.status===404?'저장소·브랜치 이름과 토큰 접근 권한을 확인해 주세요.':[409,422].includes(response.status)?'저장소가 변경되었거나 직접 반영이 제한되어 있습니다. 내용을 확인한 뒤 다시 시도해 주세요.':'연결 상태를 확인한 뒤 다시 시도해 주세요.';throw new Error(`GitHub 오류 ${response.status}. ${hint}`)}
    return response.json();
  };
  const refPath=`/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
  onProgress('저장소 확인 중…');const ref=await request(refPath),head=ref.object.sha;
  const commit=await request(`/git/commits/${head}`);
  onProgress('업데이트 파일 준비 중…');
  const tree=await request('/git/trees','POST',{base_tree:commit.tree.sha,tree:files.map(x=>({path:x.path,mode:'100644',type:'blob',content:x.content}))});
  if(tree.sha===commit.tree.sha)return {unchanged:true,url:`https://github.com/${owner}/${repo}/commits/${encodeURIComponent(branch)}`};
  const next=await request('/git/commits','POST',{message:message||'Update Project Hub from source ZIP',tree:tree.sha,parents:[head]});
  // Never force an update: concurrent changes must stay intact.
  const latest=await request(refPath);if(latest.object.sha!==head)throw new Error('업데이트 준비 중 저장소가 변경되었습니다. 다시 적용해 주세요.');
  onProgress('저장소에 반영 중…');await request(`/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`,'PATCH',{sha:next.sha,force:false});
  return {sha:next.sha,url:`https://github.com/${owner}/${repo}/commit/${next.sha}`};
}

function installUpdater(){
  const picker=document.getElementById('updatePackageFile');if(!picker)return;
  picker.accept='.json,.mph,.zip';
  const button=document.getElementById('updatePackageBtn');button.textContent='⇩ 개발 결과 / 앱 ZIP 반영';
  const dialog=document.createElement('dialog');dialog.className='source-update-dialog';
  dialog.innerHTML=`<form method="dialog"><div class="section-head"><h2>ZIP으로 앱 업데이트</h2><button type="button" data-close aria-label="닫기">×</button></div><p>선택한 소스를 GitHub 저장소에 반영합니다. Pages 배포가 끝나면 사이트가 업데이트됩니다.</p><p data-file></p><details open><summary>반영할 파일</summary><ul data-files></ul></details><p data-skipped class="help"></p><label>GitHub 소유자<input name="owner" required value="passionyyj-ai" autocomplete="off"></label><label>저장소<input name="repo" required value="My-Project-Hub" autocomplete="off"></label><label>배포 브랜치<input name="branch" required value="main" autocomplete="off"></label><label>GitHub 인증 토큰<input name="token" type="password" required autocomplete="off" spellcheck="false" placeholder="해당 저장소의 Contents 쓰기 권한"></label><p class="help">토큰은 저장하지 않으며 GitHub API로만 전송합니다. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">GitHub에서 토큰 만들기</a></p><p class="help">이 저장소만 선택하고 Repository permissions → Contents를 Read and write로 설정하세요. Pages는 선택한 브랜치의 루트에서 배포하도록 설정해야 합니다.</p><label class="update-confirm"><input name="reviewed" type="checkbox" required>파일 목록과 저장소를 확인했으며 이 소스로 앱을 업데이트합니다.</label><p data-status role="status" aria-live="polite"></p><div data-result></div><div class="modal-actions"><button type="button" data-close class="soft">닫기</button><button type="submit" class="primary">앱 업데이트 적용</button></div></form>`;
  document.body.append(dialog);
  const style=document.createElement('style');style.textContent='.source-update-dialog{width:min(600px,94vw);max-height:90vh;overflow:auto;border:1px solid #d9e1e5;border-radius:20px;padding:24px;color:#17324d}.source-update-dialog::backdrop{background:#081b2bb3}.source-update-dialog h2{font-size:24px}.source-update-dialog label{display:block;margin:12px 0;font-weight:700}.source-update-dialog input:not([type=checkbox]){display:block;width:100%;padding:10px;min-height:46px;border:1px solid #d9e1e5;border-radius:9px}.source-update-dialog ul{font-size:14px;overflow-wrap:anywhere}.source-update-dialog .update-confirm{font-size:14px}.source-update-dialog a{color:#245e94}.source-update-dialog [data-status]{font-size:15px;font-weight:700;overflow-wrap:anywhere}';document.head.append(style);
  const form=dialog.querySelector('form'),status=dialog.querySelector('[data-status]'),submit=form.querySelector('[type=submit]');
  let pack=null,filename='',working=false,selection=0;
  const close=()=>{if(working)return;selection++;form.elements.token.value='';pack=null;dialog.close()};
  dialog.querySelectorAll('[data-close]').forEach(x=>x.onclick=close);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close()});
  dialog.addEventListener('keydown',e=>e.stopPropagation());
  document.addEventListener('change',async e=>{
    if(e.target!==picker)return;const file=picker.files?.[0];if(!file||!file.name.toLowerCase().endsWith('.zip'))return;
    e.stopImmediatePropagation();const selected=++selection;picker.value='';pack=null;filename=file.name;form.elements.token.value='';form.elements.reviewed.checked=false;submit.disabled=true;
    dialog.querySelector('[data-file]').textContent=filename;dialog.querySelector('[data-files]').replaceChildren();dialog.querySelector('[data-skipped]').textContent='';dialog.querySelector('[data-result]').replaceChildren();status.textContent='ZIP 확인 중…';document.body.classList.remove('menu-open');dialog.showModal();
    try{const parsed=await readSourceZip(await file.arrayBuffer());if(selected!==selection||!dialog.open)return;pack=parsed;
      for(const item of pack.files){const li=document.createElement('li');li.textContent=`${item.path} (${Math.ceil(item.size/1024)} KB)`;dialog.querySelector('[data-files]').append(li)}
      dialog.querySelector('[data-skipped]').textContent=`기존 연결 설정(config.js)을 유지합니다.${pack.skipped.length?' 반영 제외: '+pack.skipped.join(', '):''}`;
      status.textContent='파일 확인이 끝났습니다. 저장소 정보와 인증 토큰을 입력하세요.';submit.disabled=false;
    }catch(error){if(selected!==selection)return;status.textContent=error.message;pack=null}
  },true);
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(working||!pack)return;working=true;submit.disabled=true;const values=new FormData(form);
    form.querySelectorAll('input,button').forEach(x=>x.disabled=true);
    try{const owner=values.get('owner').trim(),repo=values.get('repo').trim(),branch=values.get('branch').trim();
      const result=await publishSource({owner,repo,branch,token:values.get('token').trim(),files:pack.files,message:`Update Project Hub: ${filename}`,onProgress:text=>status.textContent=text});
      status.textContent=result.unchanged?'저장소에 이미 같은 소스가 있습니다.':'저장소 반영 완료. GitHub Pages 배포 상태를 확인한 뒤 사이트를 새로고침하세요.';
      const history=document.createElement('a');history.href=result.url;history.target='_blank';history.rel='noopener noreferrer';history.textContent='반영 내용 확인';
      const actions=document.createElement('a');actions.href=`https://github.com/${owner}/${repo}/actions`;actions.target='_blank';actions.rel='noopener noreferrer';actions.textContent='배포 상태 확인';dialog.querySelector('[data-result]').replaceChildren(history,document.createTextNode(' · '),actions);pack=null;
    }catch(error){status.textContent=error.message||'업데이트에 실패했습니다. 연결 상태를 확인해 주세요.'}
    finally{working=false;form.elements.token.value='';form.querySelectorAll('input,button').forEach(x=>x.disabled=false);submit.disabled=!pack}
  });
}
if(typeof document!=='undefined')installUpdater();
