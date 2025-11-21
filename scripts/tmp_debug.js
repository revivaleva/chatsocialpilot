
// Preset editor logic
(() => {
  let loadedPresetId = null; // if editing an existing saved preset
  const steps = [];
  // status per step: 'idle' | 'running' | 'ok' | 'fail'
  const stepStatuses = [];
  // logs for manual runs
  const presetLogs = [];
  let editingIndex = -1; // in-editor step index (-1 none)
  function appendPresetLog(obj) { try { presetLogs.push(Object.assign({ ts: new Date().toISOString() }, obj)); renderPresetLog(); } catch (e) {} }
  function renderPresetLog() { const out = document.getElementById('presetLogOutput'); if (!out) return; out.textContent = presetLogs.map(l=> JSON.stringify(l, null, 2)).join('\n\n'); out.scrollTop = out.scrollHeight; }
  const presetMsg = document.getElementById('presetMsg');
  let currentPresetMeta = null;
  function renderSteps(){
    const tbody = document.querySelector('#presetStepsTable tbody'); tbody.innerHTML = '';
    steps.forEach((s,i)=>{
      const tr = document.createElement('tr');
      tr.setAttribute('draggable','true');
      tr.dataset.index = String(i);
      // drag handlers
      tr.addEventListener('dragstart', (e)=>{ e.dataTransfer.setData('text/plain', String(i)); tr.classList.add('dragging'); });
      tr.addEventListener('dragend', (e)=>{ tr.classList.remove('dragging'); });
      tr.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      tr.addEventListener('drop', (e)=>{
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = Number(tr.dataset.index);
        if (isNaN(from) || isNaN(to) || from === to) return;
        const item = steps.splice(from,1)[0];
        steps.splice(to,0,item);
        // adjust statuses array similarly
        const st = stepStatuses.splice(from,1)[0];
        stepStatuses.splice(to,0,st);
        renderSteps();
      });
      const tdIdx = document.createElement('td'); tdIdx.textContent = String(i+1);
      // status icon
      const statusSpan = document.createElement('span'); statusSpan.style.marginRight = '8px';
      const st = stepStatuses[i] || 'idle';
      if (st === 'ok') { statusSpan.textContent = '✓'; statusSpan.className = 'ok'; }
      else if (st === 'fail') { statusSpan.textContent = '✗'; statusSpan.className = 'fail'; }
      else if (st === 'running') { statusSpan.textContent = '…'; statusSpan.className = 'muted'; }
      tdIdx.prepend(statusSpan);
      const tdAct = document.createElement('td'); tdAct.textContent = s.type;
      const tdParam = document.createElement('td'); tdParam.textContent = s.type==='navigate'? (s.url||'') : s.type==='click'? (s.selector||'') : (s.amount||'');
      const tdRem = document.createElement('td');
      const editBtn = document.createElement('button'); editBtn.textContent='編集'; editBtn.onclick = ()=>{ startEdit(i); showStepEditor(); };
      const delBtn = document.createElement('button'); delBtn.textContent='削除'; delBtn.onclick=()=>{ if (editingIndex===i) cancelEdit(); steps.splice(i,1); stepStatuses.splice(i,1); renderSteps(); };
      tdRem.appendChild(editBtn); tdRem.appendChild(delBtn);
      tr.appendChild(tdIdx); tr.appendChild(tdAct); tr.appendChild(tdParam); tr.appendChild(tdRem); tbody.appendChild(tr);
    });
  }
  // helper to show/hide editor
  function showStepEditor(){ const ed = document.getElementById('stepEditor'); if (ed) ed.style.display = 'block'; document.getElementById('cancelEditBtn').style.display = 'inline-block'; }
  function hideStepEditor(){ const ed = document.getElementById('stepEditor'); if (ed) ed.style.display = 'none'; document.getElementById('cancelEditBtn').style.display = 'none'; editingIndex = -1; document.getElementById('addStepBtn').textContent = '追加'; }
  // Log panel controls (not used in simplified modal)

  const newAction = document.getElementById('newActionType');
  const newUrl = document.getElementById('newUrl');
  const newSelector = document.getElementById('newSelector');
  const newEval = document.getElementById('newEvalCode');
  const evalTemplateSelect = document.getElementById('evalTemplateSelect'); // may be null
  const insertEvalTemplateBtn = document.getElementById('insertEvalTemplateBtn'); // may be null
  const newScrollAmount = document.getElementById('newScrollAmount'); // may be null
  function updateNewInputs(){
    const v = (newAction && newAction.value) ? newAction.value : 'navigate';
    if (newUrl) newUrl.style.display = v==='navigate'? 'inline-block':'none';
    if (newSelector) newSelector.style.display = v==='click'? 'inline-block':'none';
    if (newEval) newEval.style.display = v==='eval' ? 'inline-block' : 'none';
    if (evalTemplateSelect) evalTemplateSelect.style.display = v==='eval' ? 'inline-block' : 'none';
    if (insertEvalTemplateBtn) insertEvalTemplateBtn.style.display = v==='eval' ? 'inline-block' : 'none';
    if (newScrollAmount) newScrollAmount.style.display = v==='scroll'? 'inline-block':'none';
    const aiBtn = document.getElementById('aiGenBtn');
    if (aiBtn) aiBtn.style.display = v==='click' ? 'inline-block' : 'none';
  }
  if (newAction) { newAction.addEventListener('change', updateNewInputs); updateNewInputs(); }

  document.getElementById('addStepBtn').onclick = ()=>{
    const type = newAction.value;
    const expectedRaw = document.getElementById('newExpected').value.trim();
    const step = { type };
    if (type==='navigate') step.url = newUrl.value.trim();
    if (type==='click') step.selector = newSelector.value.trim();
    if (type==='eval') step.code = newEval.value || '';
    if (type==='scroll') step.amount = Number(newScrollAmount.value || 0);
    if (expectedRaw) {
      // treat as substring or regex if starts and ends with /
      step.expected = {};
      if (expectedRaw.startsWith('/') && expectedRaw.endsWith('/')) step.expected.urlContains = expectedRaw.slice(1,-1);
      else step.expected.urlContains = expectedRaw;
    }
    if (editingIndex >= 0) {
      // update existing
      steps[editingIndex] = step;
      editingIndex = -1;
      document.getElementById('cancelEditBtn').style.display = 'none';
      document.getElementById('addStepBtn').textContent = '追加';
    } else {
      steps.push(step); stepStatuses.push('idle');
    }
    // reset input fields
    newUrl.value=''; newSelector.value=''; newEval.value=''; newScrollAmount.value=''; document.getElementById('newExpected').value='';
    renderSteps();
  };

  // add "ステップ追加" button to header area
  const presetsHeader = document.querySelector('#presetStepsTable')?.parentElement;
  if (presetsHeader) {
    const addBtn = document.createElement('button'); addBtn.textContent = 'ステップを追加';
    addBtn.style.marginRight = '8px';
    addBtn.onclick = ()=> {
      // create empty step and open editor for it
      const empty = { type: 'navigate', url: '' };
      steps.push(empty); stepStatuses.push('idle');
      renderSteps();
      startEdit(steps.length - 1);
      showStepEditor();
    };
    presetsHeader.insertBefore(addBtn, presetsHeader.firstChild);
  }

  function startEdit(idx) {
    if (idx < 0 || idx >= steps.length) return;
    const s = steps[idx];
    editingIndex = idx;
    newAction.value = s.type || 'navigate'; updateNewInputs();
    if (s.type === 'navigate') newUrl.value = s.url || '';
    if (s.type === 'click') newSelector.value = s.selector || '';
    if (s.type === 'eval') newEval.value = s.code || '';
    if (s.type === 'scroll') newScrollAmount.value = String(s.amount || 0);
    document.getElementById('addStepBtn').textContent = '更新';
    const ed = document.getElementById('stepEditor'); if (ed) ed.style.display = 'block';
    const cancelBtn = document.getElementById('cancelEditBtn'); if (cancelBtn) cancelBtn.style.display = 'inline-block';
  }

  function cancelEdit() {
    editingIndex = -1;
    document.getElementById('addStepBtn').textContent = '追加';
    document.getElementById('cancelEditBtn').style.display = 'none';
    newUrl.value=''; newSelector.value=''; newEval.value=''; newScrollAmount.value=''; document.getElementById('newExpected').value='';
  }

  document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
  document.getElementById('savePresetBtn').onclick = async ()=>{
    presetMsg.textContent = '保存中...';
    try{
      if (!loadedPresetId) { presetMsg.textContent='既存プリセットのみ編集可能です'; return; }
      if (!steps.length) { presetMsg.textContent='ステップを追加してください'; return; }
      const body = { name: currentPresetMeta ? currentPresetMeta.name : '', description: currentPresetMeta ? currentPresetMeta.description : '', steps };
      const r = await fetch('/api/presets/' + loadedPresetId, { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(j.error || 'update failed');
      presetMsg.textContent = '保存しました (id='+loadedPresetId+')';
      await loadPresetsList();
    } catch(e){ presetMsg.textContent = '保存失敗: '+String(e); }
  };

  // new/delete preset buttons removed in simplified modal

  // Preset list handling
  async function loadPresetsList(){
    try {
      const resp = await fetch('/api/presets', { cache: 'no-cache' });
      let j;
      try { j = await resp.json(); } catch (e) { j = {}; }
      const sel = document.getElementById('presetListSelect');
      if (j && j.items && Array.isArray(j.items)) {
        if (sel) {
          sel.innerHTML = '';
          const empty = document.createElement('option'); empty.value=''; empty.textContent='-- 保存済プリセット --'; sel.appendChild(empty);
          j.items.forEach(p=>{ const o = document.createElement('option'); o.value = p.id; o.textContent = `${p.id}: ${p.name}`; sel.appendChild(o); });
        }
        // populate visible presets table if present
        const table = document.getElementById('presetsListTable');
        if (table) {
          const tbody = table.querySelector('tbody'); tbody.innerHTML = '';
          j.items.forEach(p=>{
            const tr = document.createElement('tr');
            const name = p.name || '';
            const desc = p.description || '';
            tr.innerHTML = `<td>${p.id}</td><td>${esc(name)}</td><td>${esc(desc)}</td><td><button class="presetEditBtn" data-id="${p.id}">編集</button> <button class="presetDeleteBtn" data-id="${p.id}">削除</button></td>`;
            tbody.appendChild(tr);
          });
          // attach handlers
          table.querySelectorAll('.presetEditBtn').forEach(btn=>{
            btn.addEventListener('click', (e)=>{
              const id = Number(btn.getAttribute('data-id'));
              const sel2 = document.getElementById('presetListSelect');
              if (sel2) sel2.value = id;
              loadPresetIntoEditor(id);
              // open modal editor
              const modal = document.getElementById('presetEditModal');
              if (modal) modal.style.display = 'flex';
              window.scrollTo({ top: 0, behavior: 'smooth' });
            });
          });
          table.querySelectorAll('.presetDeleteBtn').forEach(btn=>{
            btn.addEventListener('click', async ()=>{
              const id = Number(btn.getAttribute('data-id'));
              if (!confirm('プリセットを削除しますか？ ID=' + id)) return;
              try {
                const r = await fetch('/api/presets/' + id, { method: 'DELETE' });
                const j2 = await r.json().catch(()=>({}));
                if (!r.ok) throw new Error(j2.error || 'delete failed');
                await loadPresetsList();
                alert('削除しました: id=' + id);
              } catch (e) {
                alert('削除失敗: ' + e);
              }
            });
          });
        }
      }
    } catch(e){ console.warn('loadPresetsList', e); }
  }

  // load button removed; presets are edited via the一覧の「編集」ボタン

  async function loadPresetIntoEditor(id){
    try {
      const r = await fetch('/api/presets'); const j = await r.json(); if (!j || !j.items) return;
      const p = (j.items||[]).find(x=>Number(x.id)===Number(id));
      if (!p) { presetMsg.textContent='プリセットが見つかりません'; return; }
      loadedPresetId = p.id;
      currentPresetMeta = { id: p.id, name: p.name || '', description: p.description || '' };
      // parse and normalize steps to editor format (type,url,selector,code,amount,expected)
      const parsed = (()=>{ try { return JSON.parse(p.steps_json||'[]'); } catch { return []; } })();
      const normalized = parsed.map(s=>{
        if (!s) return {};
        if (s.type) return s; // already in editor format
        // support legacy shapes: { command, params } or { id, command, params }
        const cmd = s.command || s.type || s.action;
        const params = s.params || s;
        if (cmd) {
          const out = { type: cmd };
          if (params.url) out.url = params.url;
          if (params.selector) out.selector = params.selector;
          if (params.eval) out.code = params.eval;
          if (params.code) out.code = params.code;
          if (params.amount) out.amount = params.amount;
          if (params.ms) out.ms = params.ms;
          if (params.expected) out.expected = params.expected;
          return out;
        }
        // fallback: try to map known keys
        const out2 = {};
        if (s.url) { out2.type = 'navigate'; out2.url = s.url; }
        else if (s.selector) { out2.type = 'click'; out2.selector = s.selector; }
        else return s;
        return out2;
      });
      steps.length = 0; stepStatuses.length = 0;
      for (const s of normalized) { steps.push(s); stepStatuses.push('idle'); }
      renderSteps();
      presetMsg.textContent = 'プリセットを読み込みました: ' + (currentPresetMeta.name || ('id='+currentPresetMeta.id));
    } catch(e){ presetMsg.textContent = '読み込み失敗: '+String(e); }
  }

  // initial load
  loadPresetsList();
  const refreshPresetsBtn = document.getElementById('refreshPresetsBtn');
  if (refreshPresetsBtn) refreshPresetsBtn.addEventListener('click', loadPresetsList);
  // Tasks list handling
  async function loadTasksList(){
    try {
      const resp = await fetch('/api/tasks');
      const j = await resp.json().catch(()=>({ items: [] }));
      const table = document.getElementById('tasksListTable');
      if (!table) return;
      const tbody = table.querySelector('tbody'); tbody.innerHTML = '';
      const items = (j && j.items) ? j.items : [];
      items.forEach(t=>{
        const tr = document.createElement('tr');
        const runId = t.runId || t.id || '';
        const preset = t.presetName || (t.preset && t.preset.name) || '';
        const container = t.containerId || '';
        const status = t.status || '';
        const scheduledAt = t.scheduled_at ? fmtTs(t.scheduled_at) : '';
        const startedAt = t.started_at ? fmtTs(t.started_at) : '';
        const elapsed = t.elapsedMs ? Math.round((t.elapsedMs||0)/1000) + 's' : (t.ended_at && t.started_at ? Math.round((t.ended_at - t.started_at)/1000)+'s' : '');
        tr.innerHTML = `<td>${esc(runId)}</td><td>${esc(preset)}</td><td>${esc(container)}</td><td>${esc(status)}</td><td>${esc(scheduledAt)}</td><td>${esc(startedAt)}</td><td>${esc(elapsed)}</td><td><button class="taskLogBtn" data-id="${runId}">ログ</button> <button class="taskCancelBtn" data-id="${runId}">キャンセル</button></td>`;
        tbody.appendChild(tr);
      });
      // attach handlers
      table.querySelectorAll('.taskLogBtn').forEach(btn=> btn.addEventListener('click', async ()=>{
        const id = btn.getAttribute('data-id');
        try {
          const r = await fetch('/api/tasks/' + encodeURIComponent(id) + '/runs');
          const j2 = await r.json();
          alert(JSON.stringify(j2, null, 2));
        } catch(e){ alert('ログ取得失敗: '+e); }
      }));
      table.querySelectorAll('.taskCancelBtn').forEach(btn=> btn.addEventListener('click', async ()=>{
        const id = btn.getAttribute('data-id');
        if (!confirm('このタスクをキャンセルしますか？')) return;
        try {
          const r = await fetch('/api/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
          const j2 = await r.json();
          if (!r.ok) throw new Error(j2.error || 'cancel failed');
          await loadTasksList();
          alert('キャンセル要求送信済');
        } catch(e){ alert('キャンセル失敗: '+e); }
      }));
    } catch(e){ console.warn('loadTasksList', e); }
  }
  // load tasks on refresh
  (function(){ loadTasksList(); setInterval(loadTasksList, 5000); })();
  // modal cancel handler (close button removed; use cancel)
  const presetModalCancel = document.getElementById('presetModalCancel');
  if (presetModalCancel) presetModalCancel.addEventListener('click', ()=>{
    const modal = document.getElementById('presetEditModal');
    if (modal) modal.style.display = 'none';
  });

  const runPresetBtn = document.getElementById('runPresetBtn');
  if (runPresetBtn) {
    runPresetBtn.addEventListener('click', async () => {
      presetMsg.textContent = '実行中...';
      try {
        if (!steps.length) { presetMsg.textContent='ステップ未定義'; return; }
        const accountEl = document.getElementById('presetAccount');
        const account = accountEl ? accountEl.value : null;
        if (!account) { presetMsg.textContent='操作対象コンテナを選択してください'; return; }
        for (let i=0;i<steps.length;i++) stepStatuses[i] = 'idle';
        renderSteps();
        for (let i=0;i<steps.length;i++) {
          const st = steps[i];
          stepStatuses[i] = 'running'; renderSteps();
          const cmdPayload = { contextId: account, command: st.type };
          if (st.type === 'navigate') cmdPayload.url = st.url;
          if (st.type === 'click' || st.type === 'type') cmdPayload.selector = st.selector;
          if (st.type === 'type') cmdPayload.text = st.text;
          cmdPayload.options = Object.assign({}, st.options || {});
          cmdPayload.options.timeoutMs = cmdPayload.options.timeoutMs || 30000;
          cmdPayload.options.screenshot = typeof cmdPayload.options.screenshot === 'undefined' ? true : cmdPayload.options.screenshot;
          cmdPayload.options.returnHtml = cmdPayload.options.returnHtml || 'trim';
          cmdPayload.options.returnCookies = cmdPayload.options.returnCookies || true;
          cmdPayload.options.waitForNavigation = (st.type === 'navigate');
          appendPresetLog({ event: 'request', step: i, payload: cmdPayload });
          const resp = await fetch('/api/container/exec', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(cmdPayload) });
          const j = await resp.json().catch(()=>({ ok:false, error:'invalid-json' }));
          appendPresetLog({ event: 'response', step: i, status: resp.status, body: j });
          const ok = resp.ok && j && j.ok === true;
          if (st.expected) {
            const exp = st.expected;
            if (exp.urlContains && !(j.url||'').includes(exp.urlContains)) {
              stepStatuses[i] = 'fail'; renderSteps();
              presetMsg.textContent = '実行失敗: Error: expected url not matched';
              return;
            }
            if (exp.htmlContains && !(j.html||'').includes(exp.htmlContains)) {
              stepStatuses[i] = 'fail'; renderSteps();
              presetMsg.textContent = '実行失敗: Error: expected html not matched';
              return;
            }
          }
          if (!ok) {
            stepStatuses[i] = 'fail'; renderSteps();
            presetMsg.textContent = '実行失敗: ' + (j && j.error ? j.error : 'step failed');
            return;
          }
          stepStatuses[i] = 'ok'; renderSteps();
        }
        presetMsg.textContent = '実行成功';
      } catch(e){ presetMsg.textContent = '実行失敗: '+String(e); }
    });
  }
  // Run preset as queued task (with overrides)
  // run-as-task UI removed in simplified modal
  // show/hide runAt based on mode
  const runModeEl = document.getElementById('runMode');
  if (runModeEl) {
    runModeEl.addEventListener('change', (e)=>{
      const v = (e.target).value;
      const runAtEl = document.getElementById('runAt');
      if (runAtEl) runAtEl.style.display = v === 'scheduled' ? 'inline-block' : 'none';
    });
  }
  // Vars modal markup
  const varsModalHtml = `
    <div id="varsModal" style="position:fixed;left:0;top:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);">
      <div style="background:#fff;padding:12px;border-radius:8px;min-width:420px;">
        <h4>テンプレート変数を入力</h4>
        <div id="varsModalBody" style="margin-top:8px;"></div>
        <div style="margin-top:12px;text-align:right;">
          <button id="varsModalCancel">キャンセル</button>
          <button id="varsModalOk" style="margin-left:8px;">登録</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', varsModalHtml);

  // Confirm modal for executing/registration (insert after vars modal)
  const confirmModalHtml = `
    <div id="confirmModal" style="position:fixed;left:0;top:0;right:0;bottom:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);">
      <div style="background:#fff;padding:12px;border-radius:8px;min-width:420px;">
        <h4 id="confirmModalTitle">実行確認</h4>
        <div id="confirmModalBody" style="margin-top:8px;">内容を確認してください</div>
        <div style="margin-top:12px;text-align:right;">
          <label style="margin-right:8px"><input type="checkbox" id="confirmDryRun" checked /> dryRun</label>
          <button id="confirmModalCancel">キャンセル</button>
          <button id="confirmModalOk" style="margin-left:8px;">確認して実行</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', confirmModalHtml);
  const confirmModal = document.getElementById('confirmModal');
  const confirmModalBody = document.getElementById('confirmModalBody');
  const confirmModalTitle = document.getElementById('confirmModalTitle');
  const confirmDryRun = document.getElementById('confirmDryRun');
  const confirmModalOk = document.getElementById('confirmModalOk');
  const confirmModalCancel = document.getElementById('confirmModalCancel');
  let __confirmProposal = null;
  function openConfirmModal(proposal, defaultDryRun) {
    __confirmProposal = proposal;
    if (confirmModalTitle) confirmModalTitle.textContent = proposal.title || '実行確認';
    if (confirmModalBody) confirmModalBody.innerHTML = `<div><strong>説明:</strong> ${esc(proposal.description||proposal.text||'')}</div>
      <div style="margin-top:8px;"><strong>プリセットID:</strong> ${proposal.presetId || '(none)'}</div>
      <div style="margin-top:8px;"><strong>推定信頼度:</strong> ${proposal.confidence||proposal.score||'(不明)'}</div>
      <div style="margin-top:8px;"><strong>予想リスク:</strong> ${proposal.risk_score||'(不明)'}</div>`;
    if (confirmDryRun) confirmDryRun.checked = !!defaultDryRun;
    if (confirmModal) confirmModal.style.display = 'flex';
  }
  if (confirmModalCancel) confirmModalCancel.onclick = ()=>{ if (confirmModal) confirmModal.style.display = 'none'; __confirmProposal = null; };
  if (confirmModalOk) confirmModalOk.onclick = async ()=>{
    try {
      const p = __confirmProposal;
      if (!p) return;
      const dry = !!(confirmDryRun && confirmDryRun.checked);
      // save confirm to audit
      await fetch('/api/chat/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId:'browser-session-1', messages: chatState.messages, proposedActions: [p], dryRun: dry }) });
      if (p.presetId) {
        const body = { containerId: presetAccount.value, overrides: { url: p.url || undefined, vars: p.vars || undefined }, runAt: null };
        const resp = await fetch('/api/presets/' + p.presetId + '/run-with-overrides', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const jr = await resp.json().catch(()=>({}));
        if (!resp.ok) throw new Error(jr.error || 'register failed');
        alert('タスク登録済: ' + (jr.runId || 'unknown'));
      } else {
        alert('プリセットIDがないため自動登録できません。手動でプリセットに変換してください。');
      }
    } catch (e) { alert('登録失敗: '+e); }
    if (confirmModal) confirmModal.style.display = 'none';
    __confirmProposal = null;
  };

  // HTML compressor utility (client-side)
  function escHtml(s){ return (s||'').toString().replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  function compressHtml(rawHtml, opts = {}) {
    const maxLen = opts.maxChars || 4000;
    const hint = (opts.hint || '').trim();
    try {
      const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
      // remove heavy nodes
      doc.querySelectorAll('script,style,link[rel=stylesheet],noscript,iframe').forEach(n => n.remove());
      // remove comments
      const removeComments = (node) => {
        for (let c = node.firstChild; c; ) {
          const next = c.nextSibling;
          if (c.nodeType === Node.COMMENT_NODE) node.removeChild(c);
          else if (c.nodeType === Node.ELEMENT_NODE) removeComments(c);
          c = next;
        }
      };
      removeComments(doc);
      // sanitize attributes
      const ATTR_WHITELIST = ['id','class','href','src','alt','title','role','aria-label','name','value'];
      const walkAndSanitize = (el, depth = 0) => {
        if (!(el instanceof Element)) return;
        for (const attr of Array.from(el.attributes || [])) {
          const n = attr.name.toLowerCase();
          if (!ATTR_WHITELIST.includes(n) || n.startsWith('on') || n.startsWith('data-')) {
            el.removeAttribute(attr.name);
            continue;
          }
          if (n === 'class') {
            const toks = (attr.value||'').split(/\s+/).filter(Boolean);
            if (toks.length > 2) el.setAttribute('class', toks.slice(0,2).join(' '));
          }
          if ((attr.value||'').length > 200) el.setAttribute(attr.name, (attr.value||'').slice(0,200));
        }
        if (depth > (opts.maxDepth || 6)) {
          const text = (el.textContent || '').trim().slice(0, 120);
          el.innerHTML = text ? escHtml(text) : '';
          return;
        }
        for (const ch of Array.from(el.children || [])) walkAndSanitize(ch, depth+1);
      };
      walkAndSanitize(doc.body, 0);

      // method-specific tweaks
      const method = String(opts.method || '').toUpperCase();
      if (method === 'C') {
        // attribute compression: shorten class names to c0,c1,...
        const classMap = new Map(); let classIdx = 0;
        const allEls = Array.from(doc.querySelectorAll('[class]'));
        for (const el of allEls) {
          const cls = (el.getAttribute('class')||'').split(/\s+/).filter(Boolean);
          const newCls = cls.map(c => {
            if (classMap.has(c)) return classMap.get(c);
            const v = 'c' + (classIdx++);
            classMap.set(c, v);
            return v;
          });
          el.setAttribute('class', newCls.join(' '));
        }
      }
      if (method === 'D') {
        // aggressive: remove heavy media, truncate long text nodes
        doc.querySelectorAll('img,svg,video,canvas,iframe').forEach(n => n.remove());
        const shrink = (node) => {
          for (const ch of Array.from(node.children || [])) {
            if (ch.textContent && ch.textContent.length > 200) {
              ch.textContent = (ch.textContent||'').slice(0,100) + '...';
            }
            shrink(ch);
          }
        };
        shrink(doc.body);
      }

      if (hint) {
        try {
          let target = null;
          if (hint.startsWith('.') || hint.startsWith('#') || hint.includes(' ') || hint.includes('>') || hint.includes('[')) {
            target = doc.querySelector(hint);
          }
          if (!target) {
            const txt = hint.toLowerCase();
            const all = Array.from(doc.body.querySelectorAll('*'));
            target = all.find(el => (el.textContent||'').toLowerCase().includes(txt));
          }
          if (target) {
            const frag = document.createElement('div');
            const path = [];
            let cur = target;
            while (cur && cur !== doc.body && path.length < 4) { path.unshift(cur); cur = cur.parentElement; }
            let parentNode = frag;
            for (const node of path) {
              const clone = node.cloneNode(false);
              parentNode.appendChild(clone);
              parentNode = clone;
            }
            parentNode.innerHTML = (target.innerHTML || '').slice(0, 200);
            let out = frag.innerHTML;
            out = out.replace(/\s+/g, ' ').trim();
            if (out.length > maxLen) out = out.slice(0, Math.floor(maxLen*0.7)) + ' ... ' + out.slice(-Math.floor(maxLen*0.3));
            return out;
          }
        } catch (e) { /* fallthrough */ }
      }

      let out = doc.body ? doc.body.innerHTML : String(rawHtml || '');
      out = out.replace(/\s+/g, ' ').trim();
      if (out.length > maxLen) {
        if (method === 'D') {
          out = out.slice(0, Math.floor(maxLen*0.8)) + ' ... ' + out.slice(-Math.floor(maxLen*0.2));
        } else {
          out = out.slice(0, Math.floor(maxLen*0.7)) + ' ... ' + out.slice(-Math.floor(maxLen*0.3));
        }
      }
      return out;
    } catch (e) {
      return (rawHtml || '').slice(0, opts.maxChars || 4000);
    }
  }

  // AI selector/eval/xpath generation modal
  const aiBtn = document.getElementById('aiGenBtn');
  if (aiBtn) {
    aiBtn.onclick = async () => {
    try {
      const overlay = document.createElement('div'); overlay.style.position='fixed'; overlay.style.left=0; overlay.style.top=0; overlay.style.right=0; overlay.style.bottom=0; overlay.style.background='rgba(0,0,0,0.4)'; overlay.style.display='flex'; overlay.style.alignItems='center'; overlay.style.justifyContent='center';
      const box = document.createElement('div'); box.style.width='80%'; box.style.height='80%'; box.style.background='#fff'; box.style.padding='12px'; box.style.borderRadius='8px'; box.style.display='flex'; box.style.flexDirection='column';
      const topRow = document.createElement('div'); topRow.style.display='flex'; topRow.style.gap='8px'; topRow.style.alignItems='center';
      const modeSelect = document.createElement('select'); modeSelect.style.padding='6px'; const optS = document.createElement('option'); optS.value='selector'; optS.textContent='CSS セレクタ'; const optX = document.createElement('option'); optX.value='xpath'; optX.textContent='XPath'; const optE = document.createElement('option'); optE.value='eval'; optE.textContent='Eval(JS)'; modeSelect.appendChild(optS); modeSelect.appendChild(optX); modeSelect.appendChild(optE);
      const hint = document.createElement('input'); hint.placeholder='ヒント（例: ホーム）'; hint.style.flex='1'; hint.style.padding='6px';
      const compressChk = document.createElement('input'); compressChk.type='checkbox'; const compressLabel = document.createElement('label'); compressLabel.textContent='圧縮'; compressLabel.style.marginLeft='4px';
      const maxChars = document.createElement('input'); maxChars.type='number'; maxChars.value='4000'; maxChars.style.width='100px'; maxChars.title='max chars';
      topRow.appendChild(modeSelect); topRow.appendChild(hint); topRow.appendChild(compressChk); topRow.appendChild(compressLabel); topRow.appendChild(maxChars);

      // method buttons and counts
      const methodRow = document.createElement('div'); methodRow.style.display='flex'; methodRow.style.gap='6px'; methodRow.style.marginTop='8px'; methodRow.style.alignItems='center';
      const btnA = document.createElement('button'); btnA.textContent='A:構造トリム';
      const btnB = document.createElement('button'); btnB.textContent='B:ヒント抽出';
      const btnC = document.createElement('button'); btnC.textContent='C:属性圧縮';
      const btnD = document.createElement('button'); btnD.textContent='D:トークン優先';
      const countsSpan = document.createElement('div'); countsSpan.style.marginLeft='auto'; countsSpan.style.fontSize='12px'; countsSpan.style.color='#444';
      const inputCount = document.createElement('span'); inputCount.textContent='入力: 0'; inputCount.style.marginRight='8px';
      const compressedCount = document.createElement('span'); compressedCount.textContent='圧縮: 0';
      countsSpan.appendChild(inputCount); countsSpan.appendChild(compressedCount);
      methodRow.appendChild(btnA); methodRow.appendChild(btnB); methodRow.appendChild(btnC); methodRow.appendChild(btnD); methodRow.appendChild(countsSpan);

      const ta = document.createElement('textarea'); ta.style.flex='1'; ta.placeholder = 'ここにHTMLを貼り付けてください（長い場合はトリムされることがあります）';
      const btnWrap = document.createElement('div'); btnWrap.style.marginTop='8px'; btnWrap.style.display='flex'; btnWrap.style.gap='8px'; btnWrap.style.alignItems='center';
      const run = document.createElement('button'); run.textContent='生成する'; const cancel = document.createElement('button'); cancel.textContent='閉じる'; const copyPromptBtn = document.createElement('button'); copyPromptBtn.textContent='プロンプトをコピー'; copyPromptBtn.style.display='none';
      btnWrap.appendChild(run); btnWrap.appendChild(cancel); btnWrap.appendChild(copyPromptBtn);

      const resultWrap = document.createElement('div'); resultWrap.style.marginTop='8px'; resultWrap.style.overflow='auto'; resultWrap.style.flex='0 0 200px'; resultWrap.style.borderTop='1px solid #eee'; resultWrap.style.paddingTop='8px';
      const resultTitle = document.createElement('div'); resultTitle.textContent='生成結果'; resultTitle.style.fontWeight='600'; resultWrap.appendChild(resultTitle);
      const resultList = document.createElement('div'); resultList.style.marginTop='6px'; resultWrap.appendChild(resultList);

      box.appendChild(topRow); box.appendChild(methodRow); box.appendChild(ta); box.appendChild(btnWrap); box.appendChild(resultWrap); overlay.appendChild(box); document.body.appendChild(overlay);

      cancel.onclick = ()=>{ overlay.remove(); };
      copyPromptBtn.onclick = async ()=>{
        const txt = copyPromptBtn.getAttribute('data-prompt') || '';
        try { await navigator.clipboard.writeText(txt); alert('プロンプトをコピーしました'); } catch(e){ alert('コピー失敗: '+e); }
      };

      run.onclick = async ()=>{
        run.disabled = true; run.textContent='生成中...'; resultList.innerHTML=''; copyPromptBtn.style.display='none';
        try {
          const htmlRaw = ta.value || '';
          const mode = modeSelect.value || 'selector';
          const hintVal = hint.value || '';
          const maxC = Number(maxChars.value || 4000) || 4000;
          // determine method flag from run.data-method or default
          const method = run.getAttribute('data-method') || 'A';
          const htmlToSend = compressChk.checked ? compressHtml(htmlRaw, { hint: hintVal, maxChars: maxC, method }) : (htmlRaw.slice(0, maxC));
          // update counts
          inputCount.textContent = '入力: ' + String((htmlRaw||'').length);
          compressedCount.textContent = '圧縮: ' + String((htmlToSend||'').length);
          const resp = await fetch('/api/ai/generate-selector', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ html: htmlToSend, hint: hintVal, mode }) });
          const j = await resp.json().catch(()=>({ ok:false, error:'invalid-json' }));
          if (!resp.ok) throw new Error(j.error || 'generation failed');
          const cands = j.candidates || [];
          if (!cands.length) {
            const pre = document.createElement('pre'); pre.textContent = 'No parsed candidates. Raw response:\n' + JSON.stringify(j.raw || j, null, 2); resultList.appendChild(pre);
            if (j.prompt) { copyPromptBtn.style.display='inline-block'; copyPromptBtn.setAttribute('data-prompt', j.prompt); }
            return;
          }
          for (const c of cands) {
            const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.alignItems='center'; row.style.gap='8px'; row.style.marginBottom='6px';
            const txt = document.createElement('div');
            if (mode === 'eval') txt.textContent = `${(c.score||0).toFixed(2)} — ${c.reason || ''}`;
            else if (mode === 'xpath') txt.textContent = `${(c.score||0).toFixed(2)} — ${c.xpath || c.selector || ''} — ${c.reason || ''}`;
            else txt.textContent = `${(c.score||0).toFixed(2)} — ${c.selector || ''} — ${c.reason || ''}`;
            const btns = document.createElement('div'); btns.style.display='flex'; btns.style.gap='6px';
            const copyBtn = document.createElement('button'); copyBtn.textContent='コピー'; copyBtn.onclick = ()=>{ const v = (mode==='eval'? c.code : (mode==='xpath'? c.xpath : c.selector)); navigator.clipboard.writeText(v||''); };
            const applyBtn = document.createElement('button'); applyBtn.textContent='適用';
            applyBtn.onclick = ()=>{
              if (mode==='eval') {
                document.getElementById('newEvalCode').value = c.code || c.code || '';
              } else if (mode==='xpath') {
                document.getElementById('newSelector').value = c.xpath || c.selector || '';
              } else {
                document.getElementById('newSelector').value = c.selector || '';
              }
              overlay.remove();
            };
            btns.appendChild(copyBtn); btns.appendChild(applyBtn);
            row.appendChild(txt); row.appendChild(btns); resultList.appendChild(row);
          }
          if (j.prompt) { copyPromptBtn.style.display='inline-block'; copyPromptBtn.setAttribute('data-prompt', j.prompt); }
        } catch(e){ alert('AI生成失敗: '+String(e)); }
        run.disabled = false; run.textContent='生成する';
      };

      // helper: compute compressed preview and update counts
      async function updateCountsAndPreview() {
        const raw = ta.value || '';
        const method = run.getAttribute('data-method') || 'A';
        const maxC = Number(maxChars.value || 4000) || 4000;
        const compressed = compressChk.checked ? compressHtml(raw, { hint: hint.value||'', maxChars: maxC, method }) : raw.slice(0, maxC);
        inputCount.textContent = '入力: ' + String((raw||'').length);
        compressedCount.textContent = '圧縮: ' + String((compressed||'').length);
      }
      ta.addEventListener('input', updateCountsAndPreview);
      hint.addEventListener('input', updateCountsAndPreview);
      compressChk.addEventListener('change', updateCountsAndPreview);
      maxChars.addEventListener('change', updateCountsAndPreview);

      // method button handlers: set run.data-method and preview
      btnA.addEventListener('click', ()=>{ run.setAttribute('data-method','A'); const out = compressHtml(ta.value||'', { hint: hint.value||'', maxChars: Number(maxChars.value||4000), method: 'A' }); ta.value = out; updateCountsAndPreview(); });
      btnB.addEventListener('click', ()=>{ run.setAttribute('data-method','B'); const out = compressHtml(ta.value||'', { hint: hint.value||'', maxChars: Number(maxChars.value||4000), method: 'B' }); ta.value = out; updateCountsAndPreview(); });
      btnC.addEventListener('click', ()=>{ run.setAttribute('data-method','C'); const out = compressHtml(ta.value||'', { hint: hint.value||'', maxChars: Number(maxChars.value||4000), method: 'C' }); ta.value = out; updateCountsAndPreview(); });
      btnD.addEventListener('click', ()=>{ run.setAttribute('data-method','D'); const out = compressHtml(ta.value||'', { hint: hint.value||'', maxChars: Number(maxChars.value||4000), method: 'D' }); ta.value = out; updateCountsAndPreview(); });
      // initial counts
      updateCountsAndPreview();
    } catch(e){ alert('AIボタンエラー: '+String(e)); }
  };

  // Eval templates insertion
  // Eval templates removed to avoid inline complex code in UI script.
  const templates = {};
  if (typeof insertEvalTemplateBtn !== 'undefined' && insertEvalTemplateBtn) {
    insertEvalTemplateBtn.addEventListener('click', ()=>{
      alert('テンプレート機能は現在無効です。');
    });
  }

})();
