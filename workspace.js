const keys=['phases','tasks','documents','roadmap','logs','ideas','bugs','releases'];
const names={phases:'단계',tasks:'작업',documents:'문서',roadmap:'로드맵 목표',logs:'개발 일지',ideas:'아이디어',bugs:'버그',releases:'릴리즈'};
const clone=value=>JSON.parse(JSON.stringify(value));
export function enhance(ctx){
  const {$,esc,toast,setSync}=ctx;
  const state=ctx.getState;
  let pending={},busy=false,retryTimer,editId=null,modalProject=null,query='',status='all',priority='all',sort='default';
  const cacheKey=()=>`mph-cache-v2:${state().user.id}`;
  const pendingKey=()=>`mph-pending-v2:${state().user.id}`;
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}};
  function persist(){try{localStorage.setItem(cacheKey(),JSON.stringify(state().rows));localStorage.setItem(pendingKey(),JSON.stringify(pending));return true}catch{setSync('기기 저장 실패','error');toast('기기 저장 공간이 부족합니다. 백업을 내려받고 다시 시도하세요.');return false}}
  const current=()=>state().rows.find(p=>p.id===state().currentId);
  function syncLabel(){const entries=Object.values(pending);setSync(entries.some(x=>x.conflict)?'충돌 확인 필요':entries.length?'미저장 변경 있음':'저장됨',entries.length?'error':'')}
  function save(project=current()){
    if(!project)return;
    const previous=pending[project.id];
    pending[project.id]={project:clone(project),base:previous?previous.base:project.updatedAt,conflict:previous?.conflict||false};
    persist();setSync('기기에 저장 · 동기화 대기','saving');clearTimeout(retryTimer);retryTimer=setTimeout(flush,550);
  }
  async function flush(){
    if(busy||!state().user)return;
    clearTimeout(retryTimer);retryTimer=null;busy=true;const owner=state().user.id;
    try{
      for(const [id,entry] of Object.entries(pending)){
        if(entry.conflict||state().user?.id!==owner)continue;
        const p=entry.project;
        let request=state().supabase.from('mph_projects').update({title:p.title,project_type:p.data.type,goal:p.data.goal,project_data:{...p.data,title:p.title},updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',owner);
        if(entry.base)request=request.eq('updated_at',entry.base);
        const {data,error}=await request.select();
        if(state().user?.id!==owner)return;
        if(error)throw error;
        if(!data?.length){entry.conflict=true;persist();toast('다른 기기의 변경 또는 접근 권한 변경이 감지되었습니다. 저장 상태를 눌러 확인하세요.');continue}
        const updated=data[0].updated_at;
        const local=state().rows.find(x=>x.id===id);if(local)local.updatedAt=updated;
        if(pending[id]===entry)delete pending[id];else if(pending[id])pending[id].base=updated;
        persist();
      }
      syncLabel();
    }catch(error){setSync('미저장 · 재시도 예정','error');clearTimeout(retryTimer);retryTimer=setTimeout(flush,10000)}
    finally{busy=false;if(Object.values(pending).some(x=>!x.conflict)&&!retryTimer)retryTimer=setTimeout(flush,550)}
  }
  async function loadProjects(){
    const owner=state().user.id;pending=read(pendingKey())||{};
    setSync('동기화 중','saving');
    let result;try{result=await state().supabase.from('mph_projects').select('*').eq('owner_id',owner).order('updated_at',{ascending:false})}catch(error){result={error}}
    if(state().user?.id!==owner)return;
    let rows;
    if(result.error){rows=read(cacheKey())||[];if(!rows.length){ctx.fail(result.error);return}}
    else rows=(result.data||[]).map(row=>({...ctx.normalize(row),updatedAt:row.updated_at}));
    for(const [id,entry] of Object.entries(pending)){const index=rows.findIndex(p=>p.id===id);if(index>=0)rows[index]=entry.project;else rows.push(entry.project)}
    ctx.setRows(rows);
    if(!rows.length){await createProject('새 프로젝트',ctx.emptyData());return}
    ctx.setCurrent(rows.some(x=>x.id===state().currentId)?state().currentId:rows[0].id);persist();ctx.render();syncLabel();if(!result.error)flush();else setSync('오프라인 · 기기에 저장','error');
  }
  async function createProject(title,data=ctx.emptyData()){
    const owner=state().user.id;setSync('프로젝트 저장 중','saving');
    const {data:row,error}=await state().supabase.from('mph_projects').insert({owner_id:owner,title,project_type:data.type,goal:data.goal,project_data:{...data,title}}).select().single();
    if(error){ctx.fail(error);return false}if(state().user?.id!==owner)return false;
    const p={...ctx.normalize(row),updatedAt:row.updated_at};state().rows.unshift(p);ctx.setCurrent(p.id);persist();ctx.render();syncLabel();return true;
  }
  function subscribe(){
    if(state().channel)state().supabase.removeChannel(state().channel);
    const owner=state().user.id;
    const channel=state().supabase.channel(`mph-${owner}`).on('postgres_changes',{event:'*',schema:'public',table:'mph_projects',filter:`owner_id=eq.${owner}`},()=>{if(state().user?.id===owner&&!busy)loadProjects()}).subscribe();ctx.setChannel(channel);
  }
  window.addEventListener('online',flush);
  window.addEventListener('beforeunload',e=>{if(Object.keys(pending).length){e.preventDefault();e.returnValue=''}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush()});
  $('syncState').onclick=async()=>{
    const conflicts=Object.entries(pending).filter(([,x])=>x.conflict);
    for(const [id,entry] of conflicts){
      if(!confirm(`“${entry.project.title}”에 다른 변경이 있습니다. 현재 내용을 백업한 뒤, 내 변경으로 덮어쓸까요? 취소하면 변경을 유지합니다.`))continue;
      if(!await exportBackup())continue;const {data,error}=await state().supabase.from('mph_projects').select('*').eq('id',id).eq('owner_id',state().user.id).single();
      if(error){ctx.fail(error);continue}entry.base=data.updated_at;entry.conflict=false;persist();
    }await flush();
  };
  $('logoutBtn').onclick=async()=>{await flush();if(Object.keys(pending).length){toast('미저장 변경이 있습니다. 저장 상태를 눌러 재시도하거나 백업해 주세요.');return}clearTimeout(retryTimer);if(state().channel)state().supabase.removeChannel(state().channel);localStorage.removeItem(cacheKey());localStorage.removeItem(pendingKey());ctx.setRows([]);ctx.setCurrent(null);await state().supabase.auth.signOut()};

  function filtered(list,key){
    let items=list.filter(x=>`${x.title||x.name||''} ${x.detail||''} ${x.fileName||''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    if(key==='tasks')items=items.filter(x=>(status==='all'||(status==='done'?x.done:!x.done))&&(priority==='all'||(x.priority||'보통')===priority));
    const weight={'높음':0,'보통':1,'낮음':2};
    if(sort==='due')items.sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
    if(sort==='priority')items.sort((a,b)=>(weight[a.priority||'보통']??1)-(weight[b.priority||'보통']??1));
    if(sort==='title')items.sort((a,b)=>(a.title||a.name||'').localeCompare(b.title||b.name||'','ko'));
    return items;
  }
  const controls=(key,item)=>`<button class="soft compact" data-edit="${key}" data-id="${esc(item.id)}">수정</button><button class="delete" aria-label="${esc(item.title||item.name)} 삭제" data-del="${key}" data-id="${esc(item.id)}">×</button>`;
  function renderList(p){
    const ids={phases:'phaseList',tasks:'taskList',documents:'documentList',roadmap:'roadmapList',logs:'logList',ideas:'ideaList',bugs:'bugList',releases:'releaseList'};
    for(const key of keys){
      const items=filtered(p.data[key]||[],key);
      $(ids[key]).innerHTML=items.map(x=>{
        const today=new Date().toLocaleDateString('sv-SE');const overdue=key==='tasks'&&!x.done&&x.dueDate&&x.dueDate<today;
        let content=key==='phases'?`<div class="progress-row"><strong>${esc(x.name)}</strong><b>${Number(x.progress)||0}%</b><div class="bar"><i style="width:${Math.min(100,Math.max(0,Number(x.progress)||0))}%"></i></div></div>`:`${key==='tasks'?`<input type="checkbox" aria-label="${esc(x.title)} 완료" data-task="${esc(x.id)}" ${x.done?'checked':''}>`:''}<div class="item-content"><h3>${esc(x.title)}</h3><p>${esc(x.detail||'')}</p>${key==='tasks'?`<p class="${overdue?'overdue':'file-meta'}">우선순위 ${esc(x.priority||'보통')} · ${x.dueDate?`기한 ${esc(x.dueDate)}${overdue?' · 지연':''}`:'기한 없음'}</p>`:`<p class="file-meta">${esc(key==='documents'?`${x.status||'예정'} · ${x.fileName||'첨부 파일 없음'}`:x.date||'')}</p>`}</div>`;
        if(key==='documents'&&x.storagePath)content+=`<div class="file-actions"><button class="soft compact" data-file-open="${esc(x.storagePath)}">열기</button><button class="soft compact" data-file-download="${esc(x.storagePath)}" data-file-name="${esc(x.fileName||'download')}">다운로드</button></div>`;
        return `<div class="item ${x.done?'done':''}">${content}<div class="item-actions">${controls(key,x)}</div></div>`;
      }).join('')||'<div class="empty">표시할 항목이 없습니다.</div>';
    }
  }
  function openModal(kind,edit=false,id=null){
    editId=id;modalProject=current();const item=id?modalProject.data[kind].find(x=>x.id===id):null;
    $('modalWrap').classList.remove('hidden');$('modalTitle').textContent=kind==='project'?(edit?'프로젝트 수정':'새 프로젝트'):`${names[kind]} ${item?'수정':'추가'}`;
    $('modalForm').dataset.kind=kind;$('modalForm').dataset.projectEdit=String(edit);
    if(kind==='project')$('modalFields').innerHTML=`<label>프로젝트명<input name="title" required value="${esc(edit?modalProject.title:'')}"></label><label>종류<input name="type" value="${esc(edit?modalProject.data.type:'일반 프로젝트')}"></label><label>목표<textarea name="goal">${esc(edit?modalProject.data.goal:'')}</textarea></label>`;
    else if(kind==='phases')$('modalFields').innerHTML=`<label>단계명<input name="title" required value="${esc(item?.name||'')}"></label><label>진행률<input name="progress" type="number" min="0" max="100" value="${Number(item?.progress)||0}"></label>`;
    else $('modalFields').innerHTML=`<label>제목<input name="title" required value="${esc(item?.title||'')}"></label><label>설명<textarea name="detail">${esc(item?.detail||'')}</textarea></label>${kind==='tasks'?`<label>기한<input type="date" name="dueDate" value="${esc(item?.dueDate||'')}"></label><label>우선순위<select name="priority">${['높음','보통','낮음'].map(x=>`<option ${(item?.priority||'보통')===x?'selected':''}>${x}</option>`).join('')}</select></label>`:''}${kind==='documents'?`<label>상태<select name="status">${['예정','진행 중','완료'].map(x=>`<option ${item?.status===x?'selected':''}>${x}</option>`).join('')}</select></label><p class="help">첨부 파일은 유지됩니다. 파일 교체는 새 문서로 등록하세요.</p><label>첨부 파일<input name="artifact" type="file" ${item?'disabled':''}></label><p class="help">첨부는 선택 사항 · 최대 20MB</p>`:''}`;
    $('modalFields').querySelector('input')?.focus();
  }
  function closeModal(){$('modalWrap').classList.add('hidden');$('modalForm').reset();editId=null}
  document.addEventListener('click',e=>{const edit=e.target.closest('[data-edit]');if(edit)openModal(edit.dataset.edit,false,edit.dataset.id)});
  document.addEventListener('click',async e=>{
    const del=e.target.closest('[data-del]');if(!del)return;e.stopImmediatePropagation();
    const p=current(),key=del.dataset.del,id=del.dataset.id;
    if(!p||!keys.includes(key)||!confirm('이 항목을 삭제할까요?'))return;
    p.data[key]=p.data[key].filter(x=>x.id!==id);ctx.render();save(p);
    // Files remain in storage until an explicit cleanup; failed saves must not destroy attachments.
  },true);
  document.addEventListener('change',e=>{if(e.target.id==='projectSelect'){closeModal();document.body.classList.remove('menu-open')}},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();document.body.classList.remove('menu-open')}});
  $('modalForm').onsubmit=async e=>{
    e.preventDefault();const button=e.target.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;
    const kind=e.target.dataset.kind,p=modalProject,f=Object.fromEntries(new FormData(e.target)),id=editId;
    try{
      if(kind==='project'){if(e.target.dataset.projectEdit==='true'){p.title=f.title.trim();p.data.type=f.type;p.data.goal=f.goal;save(p)}else if(!await createProject(f.title.trim(),{...ctx.emptyData(),type:f.type,goal:f.goal}))return}
      else{
        const old=id?p.data[kind].find(x=>x.id===id):null;
        const item={...old,id:old?.id||crypto.randomUUID(),title:f.title.trim(),detail:f.detail||'',date:old?.date||new Date().toLocaleDateString('ko-KR')};
        if(!item.title)return toast('제목을 입력해 주세요.');
        if(kind==='phases'){item.name=item.title;item.progress=Math.max(0,Math.min(100,Number(f.progress)||0))}
        if(kind==='tasks'){item.done=old?.done||false;item.dueDate=f.dueDate||'';item.priority=f.priority||'보통'}
        if(kind==='documents'){
          item.status=f.status;const file=f.artifact;
          if(file?.size){if(file.size>20971520)return toast('파일은 20MB 이하만 업로드할 수 있습니다.');const path=`${p.id}/${crypto.randomUUID()}-${file.name.replace(/[^\p{L}\p{N}._-]+/gu,'_')}`;
            const {error}=await state().supabase.storage.from('mph-project-files').upload(path,file,{contentType:file.type||'application/octet-stream'});if(error)throw error;
            Object.assign(item,{storagePath:path,fileName:file.name,size:file.size,mimeType:file.type});
          }
        }
        if(old)Object.assign(old,item);else p.data[kind].unshift(item);save(p);
      }
      closeModal();ctx.render();
    }catch(error){ctx.fail(error)}finally{button.disabled=false}
  };

  // The existing sidebar becomes a drawer so every desktop action is reachable on mobile.
  $('mobileMenuBtn').onclick=()=>document.body.classList.toggle('menu-open');
  $('menuBackdrop').onclick=()=>document.body.classList.remove('menu-open');
  $('menuClose').onclick=()=>document.body.classList.remove('menu-open');
  document.querySelector('.sidebar nav').addEventListener('click',()=>document.body.classList.remove('menu-open'));
  $('searchInput').oninput=e=>{query=e.target.value;ctx.render()};
  $('taskStatusFilter').onchange=e=>{status=e.target.value;ctx.render()};
  $('priorityFilter').onchange=e=>{priority=e.target.value;ctx.render()};
  $('sortSelect').onchange=e=>{sort=e.target.value;ctx.render()};
  async function exportBackup(){
    const projects=clone(state().rows);setSync('백업 파일 준비 중','saving');
    try{
      for(const p of projects)for(const doc of p.data.documents||[]){if(!doc.storagePath)continue;
        const {data,error}=await state().supabase.storage.from('mph-project-files').download(doc.storagePath);if(error)throw error;
        doc.contentBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(data)});
      }
      const blob=new Blob([JSON.stringify({schema:'mph-backup-v1',exportedAt:new Date().toISOString(),projects},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`project-hub-backup-${new Date().toLocaleDateString('sv-SE')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);syncLabel();return true;
    }catch(error){ctx.fail(error);toast('백업에 실패했습니다. 첨부 파일 접근과 연결 상태를 확인하세요.');return false}
  }
  function validateProjects(projects){
    if(!Array.isArray(projects)||!projects.length)throw new Error('프로젝트가 없는 백업입니다.');
    for(const p of projects){if(typeof p.title!=='string'||!p.data||typeof p.data!=='object')throw new Error('프로젝트 형식이 잘못되었습니다.');for(const key of keys){if(!Array.isArray(p.data[key]))throw new Error(`${names[key]} 목록이 잘못되었습니다.`);for(const item of p.data[key])if(!item||typeof item!=='object'||typeof (key==='phases'?item.name:item.title)!=='string')throw new Error('항목 형식이 잘못되었습니다.')}}
  }
  async function restore(file){
    try{
      const pack=JSON.parse(await file.text());if(pack.schema!=='mph-backup-v1')throw new Error('지원하지 않는 백업입니다.');validateProjects(pack.projects);
      if(!confirm(`${pack.projects.length}개 프로젝트를 새 복사본으로 복원할까요? 기존 프로젝트는 유지됩니다.`))return;
      for(const source of pack.projects){
        const data=clone(source.data);for(const doc of data.documents){delete doc.storagePath;delete doc.contentBase64}
        if(!await createProject(`${source.title} (복원)`,data))throw new Error('프로젝트 복원 실패');const p=current();
        for(let i=0;i<source.data.documents.length;i++){const original=source.data.documents[i];if(!original.contentBase64)continue;
          const bytes=ctx.base64Bytes(original.contentBase64);if(bytes.length>20971520)throw new Error('첨부 파일이 20MB를 초과합니다.');
          const path=`${p.id}/${crypto.randomUUID()}-${(original.fileName||'attachment').replace(/[^\p{L}\p{N}._-]+/gu,'_')}`;
          const {error}=await state().supabase.storage.from('mph-project-files').upload(path,new Blob([bytes],{type:original.mimeType||'application/octet-stream'}));if(error)throw error;
          p.data.documents[i].storagePath=path;delete p.data.documents[i].contentBase64;save(p);
        }
        for(const doc of p.data.documents)delete doc.contentBase64;save(p);
      }ctx.render();toast('백업을 새 프로젝트로 복원했습니다.');
    }catch(error){ctx.fail(error);toast('복원 중 오류가 발생했습니다. 이미 복원된 복사본은 유지됩니다.')}
  }
  $('exportBackupBtn').onclick=exportBackup;$('restoreBackupBtn').onclick=()=>$('restoreBackupFile').click();$('restoreBackupFile').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(file)await restore(file)};
  async function importUpdatePackage(file){
    const original=current();if(!original)return;
    let uploaded=[];
    try{
      const pack=JSON.parse(await file.text());if(pack.schema!=='mph-update-v1'||!pack.updateId)throw new Error('지원하지 않는 업데이트 형식입니다.');
      if(original.data.importedUpdates?.includes(pack.updateId))return toast('이미 반영한 업데이트입니다.');
      for(const key of keys)if(pack[key]!==undefined&&(!Array.isArray(pack[key])||pack[key].some(x=>!x||typeof (key==='phases'?x.name:x.title)!=='string')))throw new Error('업데이트 항목 형식이 잘못되었습니다.');
      if(!confirm(`“${pack.projectTitle||original.title}” 개발 결과를 현재 “${original.title}”에 반영할까요?`))return;
      const draft=clone(original);
      for(const key of keys)for(const raw of pack[key]||[]){
        const found=draft.data[key].find(x=>(raw.sourceId&&x.sourceId===raw.sourceId)||(raw.id&&x.id===raw.id)||(key==='phases'?x.name===raw.name:x.title===raw.title));
        const item={...found,...raw,id:found?.id||raw.id||crypto.randomUUID()};
        if(key==='phases')item.progress=Math.max(0,Math.min(100,Number(item.progress)||0));
        if(key==='documents'&&raw.contentBase64){const bytes=ctx.base64Bytes(raw.contentBase64);if(bytes.length>20971520)throw new Error('파일은 20MB 이하만 가능합니다.');const path=`${original.id}/${crypto.randomUUID()}-${(raw.fileName||'attachment').replace(/[^\p{L}\p{N}._-]+/gu,'_')}`;const {error}=await state().supabase.storage.from('mph-project-files').upload(path,new Blob([bytes],{type:raw.mimeType||'application/octet-stream'}));if(error)throw error;uploaded.push(path);item.storagePath=path;item.size=bytes.length;delete item.contentBase64}
        if(found)Object.assign(found,item);else draft.data[key].unshift(item);
      }
      if(pack.nextTask){if(typeof pack.nextTask.title!=='string')throw new Error('다음 작업 형식 오류');const task=pack.nextTask;const found=draft.data.tasks.find(x=>x.title===task.title);if(found)Object.assign(found,task,{done:false});else draft.data.tasks.unshift({...task,id:crypto.randomUUID(),done:false})}
      draft.data.importedUpdates=[...(draft.data.importedUpdates||[]),pack.updateId];original.data=draft.data;save(original);ctx.render();toast('개발 결과를 반영했습니다.');
    }catch(error){if(uploaded.length)await state().supabase.storage.from('mph-project-files').remove(uploaded);ctx.fail(error)}
  }
  ctx.install({save,loadProjects,subscribe,createProject,renderList,openModal,closeModal,importUpdatePackage});
}
