;(function(){
'use strict';
var api=window.electronAPI;
if(!api)return;

var state={
connected:false,
models:[],
selectedModel:null,
conversations:[],
activeConversationId:null,
isGenerating:false,
currentRequestId:null,
systemPrompt:'',
ollamaUrl:'http://127.0.0.1:11434',
theme:'dark',
modelCaps:{},
attachedFiles:[]
};

var pendingDeleteId=null;
var inputExpanded=false;
var compactTimer=null;
var prevRenderedLen=0;

function el(id){return document.getElementById(id)}

function saveNow(){
try{
var d={
conversations:state.conversations,
selectedModel:state.selectedModel,
systemPrompt:state.systemPrompt,
ollamaUrl:state.ollamaUrl,
theme:state.theme,
activeConversationId:state.activeConversationId,
modelCaps:state.modelCaps
};
localStorage.setItem('rawgpt_v4',JSON.stringify(d));
}catch(e){}
}

var _st=null;
function save(){if(_st)clearTimeout(_st);_st=setTimeout(saveNow,200)}
window.addEventListener('beforeunload',saveNow);
setInterval(function(){if(state.conversations.length>0)saveNow()},8000);

function load(){
try{
var r=localStorage.getItem('rawgpt_v4');
if(r){
var d=JSON.parse(r);
state.conversations=d.conversations||[];
state.selectedModel=d.selectedModel||null;
state.systemPrompt=d.systemPrompt||'';
state.ollamaUrl=d.ollamaUrl||'http://127.0.0.1:11434';
state.theme=d.theme||'dark';
state.activeConversationId=d.activeConversationId||null;
state.modelCaps=d.modelCaps||{};
state.conversations.forEach(function(c){
c.messages=c.messages.filter(function(m){return!m._partial});
});
}
}catch(e){}
}

function setTheme(t){
state.theme=t;
document.documentElement.setAttribute('data-theme',t);
document.querySelectorAll('[data-theme-set]').forEach(function(b){
b.classList.toggle('active',b.getAttribute('data-theme-set')===t)
});
document.querySelectorAll('[data-theme-val]').forEach(function(b){
b.classList.toggle('active',b.getAttribute('data-theme-val')===t)
});
save();
}

async function autoConnect(){
setStatusUI('connecting','Подключение...');
var urls=[state.ollamaUrl];
if(urls.indexOf('http://127.0.0.1:11434')<0)urls.push('http://127.0.0.1:11434');
if(urls.indexOf('http://localhost:11434')<0)urls.push('http://localhost:11434');
for(var i=0;i<urls.length;i++){
try{
var r=await api.ollamaPing(urls[i]);
if(r&&r.success){
state.ollamaUrl=urls[i];
await api.ollamaSetUrl(urls[i]);
state.connected=true;
setStatusUI('connected','Подключено');
save();
await loadModels();
return;
}
}catch(e){}
}
state.connected=false;
setStatusUI('disconnected','Ollama не найдена');
}

function setStatusUI(s,t){
var d=el('statusDot'),x=el('statusText');
if(d)d.className='status-dot '+s;
if(x)x.textContent=t;
}

async function detectModelCaps(modelName){
if(state.modelCaps[modelName])return state.modelCaps[modelName];
var caps={vision:false,thinking:false,tools:false,code:false};
var base=modelName.split(':')[0].toLowerCase();

if(/gemma3|llava|bakllava|moondream|minicpm-v|llama3\.2-vision|yi-vision/.test(base))caps.vision=true;
if(/deepseek-r1|qwen3|qwq/.test(base))caps.thinking=true;
if(/coder|codellama|starcoder|deepseek-coder|code/.test(base))caps.code=true;

try{
var r=await api.ollamaModelShow(modelName);
if(r&&r.success&&r.data){
var tmpl=(r.data.template||'').toLowerCase();
var params=(r.data.parameters||'').toLowerCase();
var modelfile=(r.data.modelfile||'').toLowerCase();
var allText=tmpl+' '+params+' '+modelfile;

if(r.data.details){
var fams=r.data.details.families||[];
for(var fi=0;fi<fams.length;fi++){
var fam=fams[fi].toLowerCase();
if(fam==='clip'||fam==='mllama'||fam.indexOf('vision')>=0)caps.vision=true;
}
if(r.data.details.family){
var df=r.data.details.family.toLowerCase();
if(df.indexOf('clip')>=0||df.indexOf('vision')>=0||df.indexOf('mllama')>=0)caps.vision=true;
}
}

if(r.data.projectors&&r.data.projectors.length>0)caps.vision=true;

if(allText.indexOf('vision')>=0||allText.indexOf('image')>=0||allText.indexOf('.image')>=0)caps.vision=true;

if(tmpl.indexOf('<think>')>=0||tmpl.indexOf('</think>')>=0||tmpl.indexOf('<reasoning>')>=0)caps.thinking=true;
if(allText.indexOf('think')>=0&&allText.indexOf('reason')>=0)caps.thinking=true;

if(tmpl.indexOf('<tool_call>')>=0||tmpl.indexOf('<|plugin|>')>=0||tmpl.indexOf('function_call')>=0||tmpl.indexOf('<tools>')>=0)caps.tools=true;
if(allText.indexOf('tool_calls')>=0||allText.indexOf('function_call')>=0)caps.tools=true;

if(allText.indexOf('code')>=0&&(allText.indexOf('programming')>=0||allText.indexOf('developer')>=0||allText.indexOf('coder')>=0))caps.code=true;
}
}catch(e){}

state.modelCaps[modelName]=caps;
save();
return caps;
}

async function loadModels(){
try{
var r=await api.ollamaListModels();
if(r&&r.success&&r.models){
state.models=r.models;
if(!state.selectedModel&&state.models.length)
state.selectedModel=state.models[0].name;
else if(state.selectedModel&&!state.models.some(function(m){return m.name===state.selectedModel}))
state.selectedModel=state.models.length?state.models[0].name:null;
save();

for(var i=0;i<state.models.length;i++){
await detectModelCaps(state.models[i].name);
}
}else{
state.models=[];
}
}catch(e){
state.models=[];
}
renderModelDD();
updModelName();
updateAttachOptions();
}

function getCaps(name){
return state.modelCaps[name]||{vision:false,thinking:false,tools:false,code:false};
}

function renderModelDD(){
var list=el('modelDropdownList');
if(!list)return;
if(!state.models.length){
list.innerHTML='<div class="model-dropdown-empty">'+(state.connected?'Нет моделей':'Нет подключения')+'</div>';
return;
}
list.innerHTML=state.models.map(function(m){
var gb=(m.size/1073741824).toFixed(1);
var sel=m.name===state.selectedModel;
var ps=m.details&&m.details.parameter_size?' · '+m.details.parameter_size:'';
var caps=getCaps(m.name);
var badges='';
if(caps.vision)badges+='<span class="feature-badge vision">Vision</span>';
if(caps.thinking)badges+='<span class="feature-badge thinking">Think</span>';
if(caps.tools)badges+='<span class="feature-badge tools">Tools</span>';
if(caps.code)badges+='<span class="feature-badge code">Code</span>';
return'<div class="model-option'+(sel?' selected':'')+'" data-m="'+esc(m.name)+
'"><div class="model-option-left"><div class="model-option-name">'+eh(m.name)+
'</div><div class="model-option-meta"><span class="model-option-info">'+gb+' GB'+ps+
'</span>'+badges+'</div></div>'+(sel?'<span class="check-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>':'')+
'</div>';
}).join('');

list.querySelectorAll('.model-option').forEach(function(o){
o.addEventListener('click',function(){
state.selectedModel=o.getAttribute('data-m');
save();updModelName();renderModelDD();
var dd=el('modelDropdown');if(dd)dd.classList.remove('show');
updateAttachOptions();
});
});
}

function updModelName(){
var e=el('currentModelName');
if(e)e.textContent=state.selectedModel?state.selectedModel.split(':')[0]:'Выберите модель';
var f=el('modelFeatures');
if(f&&state.selectedModel){
var caps=getCaps(state.selectedModel);
var h='';
if(caps.vision)h+='<span class="feature-badge vision">Vision</span>';
if(caps.thinking)h+='<span class="feature-badge thinking">Think</span>';
if(caps.tools)h+='<span class="feature-badge tools">Tools</span>';
if(caps.code)h+='<span class="feature-badge code">Code</span>';
f.innerHTML=h;
}else if(f)f.innerHTML='';
}

function updateAttachOptions(){
var caps=state.selectedModel?getCaps(state.selectedModel):{};
var imgBtn=el('attachImage');
if(imgBtn){
if(caps.vision){imgBtn.classList.remove('disabled');imgBtn.disabled=false}
else{imgBtn.classList.add('disabled');imgBtn.disabled=true}
}
}

function addFile(fileData){
state.attachedFiles.push(fileData);
renderFilePreviews();
expandInput();
updateSendBtn();
}

function removeFile(idx){
state.attachedFiles.splice(idx,1);
renderFilePreviews();
updateSendBtn();
if(!state.attachedFiles.length){
var inp=el('messageInput');
if(inp&&!inp.value.trim())tryCompactInput();
}
}

function renderFilePreviews(){
var container=el('filePreviews');
if(!container)return;
if(!state.attachedFiles.length){container.innerHTML='';return}
container.innerHTML=state.attachedFiles.map(function(f,i){
var thumb='';
if(f.isImage){
thumb='<img class="file-preview-thumb" src="data:'+f.mime+';base64,'+f.base64+'">';
}else{
thumb='<div class="file-preview-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>';
}
return'<div class="file-preview-item">'+thumb+
'<span class="file-preview-name">'+eh(f.name)+'</span>'+
'<button class="file-preview-remove" data-idx="'+i+'">×</button></div>';
}).join('');

container.querySelectorAll('.file-preview-remove').forEach(function(btn){
btn.addEventListener('click',function(){
removeFile(parseInt(btn.getAttribute('data-idx')));
});
});
}

function getActive(){
if(!state.activeConversationId)return null;
return state.conversations.find(function(c){return c.id===state.activeConversationId})||null;
}

function renderConvs(){
var ct=el('conversationList');if(!ct)return;
if(!state.conversations.length){
ct.innerHTML='<div style="padding:24px 12px;text-align:center;color:var(--text-muted);font-size:12.5px;">Начните новый чат</div>';
return;
}
var now=new Date();
var today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
var g=[{l:'Сегодня',i:[]},{l:'Вчера',i:[]},{l:'7 дней',i:[]},{l:'Ранее',i:[]}];
state.conversations.forEach(function(c){
if(c.created>=today)g[0].i.push(c);
else if(c.created>=today-86400000)g[1].i.push(c);
else if(c.created>=today-604800000)g[2].i.push(c);
else g[3].i.push(c);
});
var h='';
g.forEach(function(gr){
if(!gr.i.length)return;
h+='<div class="conversation-group-label">'+gr.l+'</div>';
gr.i.forEach(function(c){
h+='<div class="conversation-item'+(c.id===state.activeConversationId?' active':'')+'" data-cid="'+c.id+
'"><span class="conv-text">'+eh(c.title)+'</span><div class="conv-actions"><button class="conv-action-btn delete-btn" data-cid="'+
c.id+'" data-title="'+esc(c.title)+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></div></div>';
});
});
ct.innerHTML=h;

ct.querySelectorAll('.conversation-item').forEach(function(e){
e.addEventListener('click',function(ev){
if(ev.target.closest('.conv-action-btn'))return;
switchConv(e.getAttribute('data-cid'));
});
});
ct.querySelectorAll('.delete-btn').forEach(function(e){
e.addEventListener('click',function(ev){
ev.stopPropagation();
showDelConfirm(e.getAttribute('data-cid'),e.getAttribute('data-title')||'');
});
});
}

function switchConv(id){
state.activeConversationId=id;save();renderConvs();
var c=getActive();
if(c&&c.messages.length){showChat();renderMsgs(c.messages)}
else showWelcome();
}

function doDelete(id){
state.conversations=state.conversations.filter(function(c){return c.id!==id});
if(state.activeConversationId===id)
state.activeConversationId=state.conversations.length?state.conversations[0].id:null;
saveNow();renderConvs();
var c=getActive();
if(c&&c.messages.length){showChat();renderMsgs(c.messages)}
else showWelcome();
}

function showDelConfirm(id,title){
pendingDeleteId=id;
var d=el('deleteConfirmDesc');
if(d)d.textContent='"'+(title||'').substring(0,35)+'" будет удалён.';
var m=el('deleteConfirmModal');if(m)m.classList.add('show');
}

function hideDelConfirm(){
pendingDeleteId=null;
var m=el('deleteConfirmModal');if(m)m.classList.remove('show');
}

function showWelcome(){
var ws=el('welcomeScreen'),cm=el('chatMessages');
if(ws)ws.style.display='flex';
if(cm){cm.style.display='none';cm.innerHTML=''}
}

function showChat(){
var ws=el('welcomeScreen'),cm=el('chatMessages');
if(ws)ws.style.display='none';
if(cm)cm.style.display='flex';
}

function renderMsgs(msgs){
var cm=el('chatMessages');if(!cm)return;cm.innerHTML='';
msgs.forEach(function(m){
if(m.role==='system')return;
cm.appendChild(mkMsg(m.role,m.content,m.images,m.files,false));
});
scrollD();
}

function mkMsg(role,content,images,files,animate){
var msg=document.createElement('div');
msg.className='message';

var av=document.createElement('div');
av.className='message-avatar '+(role==='user'?'user-av':'assistant-av');
av.textContent=role==='user'?'U':'R';

var cd=document.createElement('div');
cd.className='message-content';

var rn=document.createElement('div');
rn.className='message-role';
rn.textContent=role==='user'?'Вы':'RawGPT';

var td=document.createElement('div');
td.className='message-text';

if(role==='user'){
var userHtml='';
if(content){
var displayContent=content;
var fileBlockRegex=/\n*--- File: .+? ---\n[\s\S]*?\n--- End of file ---/g;
displayContent=displayContent.replace(fileBlockRegex,'').trim();
if(displayContent)userHtml+='<p>'+eh(displayContent)+'</p>';
}
if(images&&images.length){
images.forEach(function(img){
userHtml+='<img class="message-image" src="data:image/jpeg;base64,'+img+'">';
});
}
if(files&&files.length){
files.forEach(function(f){
userHtml+='<div class="message-file-attachment">';
userHtml+='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
userHtml+='<span>'+eh(f.name)+'</span>';
userHtml+='</div>';
});
}
td.innerHTML=userHtml;
}else if(content){
if(animate)td.innerHTML=animateWords(mdRender(content));
else td.innerHTML=mdRender(content);
}

cd.appendChild(rn);
cd.appendChild(td);

if(role==='assistant'){
var acts=document.createElement('div');
acts.className='message-actions';
acts.innerHTML=
'<button class="msg-action-btn copy-msg-btn" title="Копировать">'+
'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>'+
'<button class="msg-action-btn regen-btn" title="Перегенерировать">'+
'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg></button>';

acts.querySelector('.copy-msg-btn').addEventListener('click',function(){
var s=this;
navigator.clipboard.writeText(content).then(function(){
s.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
setTimeout(function(){
s.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
},2000);
});
});

acts.querySelector('.regen-btn').addEventListener('click',regen);
cd.appendChild(acts);
}

msg.appendChild(av);
msg.appendChild(cd);
setTimeout(function(){bindCopy(msg)},10);
return msg;
}

function animateWords(html){
var tmp=document.createElement('div');
tmp.innerHTML=html;
var walker=document.createTreeWalker(tmp,NodeFilter.SHOW_TEXT,null,false);
var nodes=[];
while(walker.nextNode())nodes.push(walker.currentNode);
var delay=0;
nodes.forEach(function(node){
var words=node.textContent.split(/(\s+)/);
var frag=document.createDocumentFragment();
words.forEach(function(w){
if(!w)return;
if(/^\s+$/.test(w)){frag.appendChild(document.createTextNode(w));return}
var span=document.createElement('span');
span.className='word-animate';
span.style.animationDelay=delay+'ms';
span.textContent=w;
frag.appendChild(span);
delay+=25;
});
if(node.parentNode)node.parentNode.replaceChild(frag,node);
});
return tmp.innerHTML;
}

function setBtnSend(){
var btn=el('sendStopBtn');if(!btn)return;
btn.className='send-stop-btn send-mode';
btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
updateSendBtn();
}

function setBtnStop(){
var btn=el('sendStopBtn');if(!btn)return;
btn.className='send-stop-btn stop-mode';
btn.disabled=false;
btn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>';
}

function updateSendBtn(){
var btn=el('sendStopBtn');
if(!btn||state.isGenerating)return;
var inp=el('messageInput');
var hasText=inp&&inp.value.trim();
var hasFiles=state.attachedFiles.length>0;
btn.disabled=!(hasText||hasFiles);
}

function expandInput(){
var ic=el('inputContainer');
if(ic&&!inputExpanded){
ic.classList.remove('compact');
ic.classList.add('expanded');
inputExpanded=true;
}
if(compactTimer){clearTimeout(compactTimer);compactTimer=null}
}

function tryCompactInput(){
if(compactTimer)clearTimeout(compactTimer);
var inp=el('messageInput');
if(inp&&!inp.value.trim()&&!state.isGenerating&&!state.attachedFiles.length){
compactTimer=setTimeout(function(){
var ic=el('inputContainer');
if(ic&&inp&&!inp.value.trim()&&document.activeElement!==inp&&!state.attachedFiles.length){
ic.classList.add('compact');
ic.classList.remove('expanded');
inputExpanded=false;
}
},1200);
}
}

async function openImageDialog(){
var r=await api.openFileDialog({type:'image'});
if(r&&!r.canceled&&r.isImage){
addFile(r);
}
var ap=el('attachPopup');if(ap)ap.classList.remove('show');
}

async function openFileDialog(){
var r=await api.openFileDialog({});
if(r&&!r.canceled){
addFile(r);
}
var ap=el('attachPopup');if(ap)ap.classList.remove('show');
}

function base64ToUtf8(b64){
try{
var binStr=atob(b64);
var bytes=new Uint8Array(binStr.length);
for(var i=0;i<binStr.length;i++){
bytes[i]=binStr.charCodeAt(i);
}
return new TextDecoder('utf-8').decode(bytes);
}catch(e){
return null;
}
}

function isTextContent(str){
if(!str||str.length===0)return false;
var check=str.substring(0,Math.min(str.length,1024));
for(var i=0;i<check.length;i++){
var code=check.charCodeAt(i);
if(code===0)return false;
}
return true;
}

function buildFileContentText(files){
var parts=[];
files.forEach(function(f){
if(f.isImage)return;
if(!f.base64||f.base64.length===0){
parts.push('[Empty file: '+f.name+']');
return;
}
var text=base64ToUtf8(f.base64);
if(text!==null&&isTextContent(text)){
parts.push('--- File: '+f.name+' ---\n'+text+'\n--- End of file ---');
}else{
parts.push('[Binary file: '+f.name+', size: '+f.size+' bytes]');
}
});
return parts.join('\n\n');
}

async function sendMsg(){
var inp=el('messageInput');
if(!inp)return;
var text=inp.value.trim();
if(!text&&!state.attachedFiles.length)return;
if(state.isGenerating)return;
if(!state.connected){alert('Нет подключения к Ollama.');return}
if(!state.selectedModel){alert('Выберите модель.');return}

var conv=getActive();
if(!conv){
conv={
id:Date.now().toString()+Math.random().toString(36).substr(2,4),
title:(text||'Файл').substring(0,50)+((text||'').length>50?'...':''),
messages:[],
created:Date.now()
};
state.conversations.unshift(conv);
state.activeConversationId=conv.id;
}

var uc=conv.messages.filter(function(m){return m.role==='user'}).length;
if(uc===0)conv.title=(text||'Файл').substring(0,50)+((text||'').length>50?'...':'');

var imageFiles=state.attachedFiles.filter(function(f){return f.isImage});
var nonImageFiles=state.attachedFiles.filter(function(f){return!f.isImage});

var fullContent=text||'';
if(nonImageFiles.length>0){
var fileText=buildFileContentText(nonImageFiles);
if(fullContent){
fullContent=fullContent+'\n\n'+fileText;
}else{
fullContent=fileText;
}
}

var userMsg={
role:'user',
content:fullContent||'[Вложение]'
};

if(imageFiles.length>0){
userMsg.images=imageFiles.map(function(f){return f.base64});
}

var fileMeta=[];
state.attachedFiles.forEach(function(f){
fileMeta.push({name:f.name,isImage:f.isImage,size:f.size,mime:f.mime});
});
if(fileMeta.length>0){
userMsg.files=fileMeta;
}

conv.messages.push(userMsg);
state.attachedFiles=[];
renderFilePreviews();

saveNow();renderConvs();showChat();
el('chatMessages').innerHTML='';
renderMsgs(conv.messages);

inp.value='';inp.style.height='auto';
updateSendBtn();

await gen(conv);
}

async function gen(conv){
state.isGenerating=true;
state.currentRequestId='r_'+Date.now()+'_'+Math.random().toString(36).substr(2,5);
prevRenderedLen=0;
setBtnStop();

var msgEl=mkMsg('assistant','',null,null,false);
var cm=el('chatMessages');if(cm)cm.appendChild(msgEl);
var td=msgEl.querySelector('.message-text');
var acts=msgEl.querySelector('.message-actions');
if(acts)acts.style.display='none';
if(td)td.innerHTML='<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
scrollD();

var apiMsgs=[];
if(state.systemPrompt&&state.systemPrompt.trim())
apiMsgs.push({role:'system',content:state.systemPrompt.trim()});

conv.messages.forEach(function(m){
if(m._partial)return;
var msg={role:m.role,content:m.content};
if(m.images&&m.images.length)msg.images=m.images;
apiMsgs.push(msg);
});

var full='',rid=state.currentRequestId,tc=0;
var lastRender=0;

api.removeAllChatListeners();

api.onChatToken(function(d){
if(d.requestId!==rid)return;
full+=d.token; tc++;

var now=Date.now();
if(now-lastRender>80){
lastRender=now;
if(td){
td.innerHTML=mdRender(full)+'<span class="stream-cursor"></span>';
bindCopy(td);
}
smartScroll();
}

if(tc%50===0)partialSave(conv,full);
});

api.onChatDone(function(){});

api.onChatEnd(function(d){
if(d.requestId!==rid)return;
finishG(conv,full,td,acts);
});

api.onChatError(function(d){
if(d.requestId!==rid)return;
if(full.length)finishG(conv,full,td,acts);
else{if(td)td.innerHTML='<div class="message-error">Ошибка: '+eh(d.error)+'</div>';cleanG()}
});

var res=await api.ollamaChatStart({model:state.selectedModel,messages:apiMsgs,requestId:rid});
if(!res||!res.success){
if(!full.length){if(td)td.innerHTML='<div class="message-error">Не удалось начать генерацию.</div>';cleanG()}
}
}

function smartScroll(){
var c=el('chatArea');
if(!c)return;
if(c.scrollHeight-c.scrollTop-c.clientHeight<100){
c.scrollTop=c.scrollHeight;
}
}

function partialSave(conv,text){
var last=conv.messages[conv.messages.length-1];
if(last&&last._partial)last.content=text;
else conv.messages.push({role:'assistant',content:text,_partial:true});
saveNow();
}

function finishG(conv,full,td,acts){
conv.messages=conv.messages.filter(function(m){return!m._partial});
if(td){
td.innerHTML=animateWords(mdRender(full));
bindCopy(td);
}
if(acts)acts.style.display='';
conv.messages.push({role:'assistant',content:full});
saveNow();cleanG();
smartScroll();
prevRenderedLen=0;
}

function cleanG(){
state.isGenerating=false;
state.currentRequestId=null;
setBtnSend();
api.removeAllChatListeners();
tryCompactInput();
}

async function stopG(){
if(state.currentRequestId)try{await api.ollamaChatAbort(state.currentRequestId)}catch(e){}
var conv=getActive();
if(conv){conv.messages.forEach(function(m){delete m._partial});saveNow()}
cleanG();
}

async function regen(){
if(state.isGenerating)return;
var conv=getActive();if(!conv||!conv.messages.length)return;
while(conv.messages.length&&conv.messages[conv.messages.length-1].role==='assistant')conv.messages.pop();
saveNow();showChat();el('chatMessages').innerHTML='';
renderMsgs(conv.messages);await gen(conv);
}

function bindCopy(c){
if(!c)return;
c.querySelectorAll('.copy-code-btn').forEach(function(b){
if(b._b)return;b._b=true;
b.addEventListener('click',function(){
var s=this,w=s.closest('.code-block-wrapper');
if(!w)return;var code=w.querySelector('code');if(!code)return;
navigator.clipboard.writeText(code.textContent).then(function(){
s.textContent='✓';setTimeout(function(){s.textContent='Копировать'},2000);
});
});
});
}

function mdRender(t){
if(!t)return'';var r=t;
r=r.replace(/```(\w*)\n([\s\S]*?)```/g,function(m,l,c){
return'<div class="code-block-wrapper"><div class="code-header"><span>'+(l||'code')+
'</span><button class="copy-code-btn">Копировать</button></div><pre><code>'+
eh(c.trimEnd())+'</code></pre></div>';
});
r=r.replace(/`([^`\n]+)`/g,'<code>$1</code>');
r=r.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
r=r.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,'<em>$1</em>');
r=r.replace(/^### (.+)$/gm,'<h3>$1</h3>');
r=r.replace(/^## (.+)$/gm,'<h2>$1</h2>');
r=r.replace(/^# (.+)$/gm,'<h1>$1</h1>');
r=r.replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>');
r=r.replace(/^---$/gm,'<hr>');
r=r.replace(/^[-*] (.+)$/gm,'<li>$1</li>');
r=r.replace(/^\d+\. (.+)$/gm,'<li>$1</li>');
r=r.replace(/((?:<li>.*?<\/li>\s*)+)/g,'<ul>$1</ul>');
r=r.split(/\n\n+/).map(function(b){
b=b.trim();if(!b)return'';
if(/^<(h[1-6]|div|pre|table|blockquote|ul|ol|hr|li|img)/.test(b))return b;
return'<p>'+b.replace(/\n/g,'<br>')+'</p>';
}).join('');
return r;
}

function eh(t){if(!t)return'';var d=document.createElement('div');d.textContent=t;return d.innerHTML}
function esc(t){return(t||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}
function scrollD(){var c=el('chatArea');if(c)c.scrollTop=c.scrollHeight}
function autoR(ta){if(!ta)return;ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,140)+'px'}
function fmtSz(b){return b>=1073741824?(b/1073741824).toFixed(1)+' GB':(b/1048576).toFixed(0)+' MB'}

function setup(){
var mn=el('minBtn'),mx=el('maxBtn'),cl=el('closeBtn');
if(mn)mn.addEventListener('click',function(){api.minimize()});
if(mx)mx.addEventListener('click',function(){api.maximize()});
if(cl)cl.addEventListener('click',function(){saveNow();api.close()});

var nc1=el('newChatBtn'),nc2=el('newChatTopBtn');
function goNew(){
if(state.isGenerating)return;
state.activeConversationId=null;
state.attachedFiles=[];
renderFilePreviews();
renderConvs();showWelcome();
var inp=el('messageInput');if(inp){inp.value='';inp.style.height='auto';inp.focus()}
setBtnSend();tryCompactInput();
}
if(nc1)nc1.addEventListener('click',goNew);
if(nc2)nc2.addEventListener('click',goNew);

var st=el('sidebarToggleBtn'),mb=el('menuBtn'),sb=el('sidebar');
if(st)st.addEventListener('click',function(){if(sb)sb.classList.toggle('collapsed')});
if(mb)mb.addEventListener('click',function(){if(sb)sb.classList.toggle('collapsed')});

var si=el('searchInput');
if(si)si.addEventListener('input',function(){
var q=si.value.toLowerCase(),ct=el('conversationList');if(!ct)return;
ct.querySelectorAll('.conversation-item').forEach(function(e){
var t=e.querySelector('.conv-text');
e.style.display=(t&&t.textContent.toLowerCase().indexOf(q)>=0)?'flex':'none';
});
});

var ms=el('modelSelector'),mdd=el('modelDropdown');
if(ms)ms.addEventListener('click',function(e){e.stopPropagation();if(mdd)mdd.classList.toggle('show')});

document.addEventListener('click',function(e){
if(mdd&&ms&&!mdd.contains(e.target)&&!ms.contains(e.target))mdd.classList.remove('show');
var ap=el('attachPopup'),ab=el('attachBtn');
if(ap&&ab&&!ap.contains(e.target)&&!ab.contains(e.target))ap.classList.remove('show');
});

var rb=el('refreshModelsBtn');
if(rb)rb.addEventListener('click',async function(){
rb.classList.add('spinning');await loadModels();
setTimeout(function(){rb.classList.remove('spinning')},500);
});

var dr=el('dropdownRefreshBtn');
if(dr)dr.addEventListener('click',function(){loadModels()});

var inp=el('messageInput');

if(inp){
inp.addEventListener('input',function(){
autoR(inp);
if(!state.isGenerating)updateSendBtn();
expandInput();
});

inp.addEventListener('focus',function(){expandInput()});
inp.addEventListener('blur',function(){tryCompactInput()});

inp.addEventListener('keydown',function(e){
if(e.key==='Enter'&&!e.shiftKey){
e.preventDefault();
if(state.isGenerating)return;
var hasText=inp.value.trim();
var hasFiles=state.attachedFiles.length>0;
if(hasText||hasFiles)sendMsg();
}
});
}

var ssb=el('sendStopBtn');
if(ssb)ssb.addEventListener('click',function(){
if(state.isGenerating)stopG();
else{
var inp2=el('messageInput');
var hasText=inp2&&inp2.value.trim();
var hasFiles=state.attachedFiles.length>0;
if(hasText||hasFiles)sendMsg();
}
});

var ab=el('attachBtn'),ap=el('attachPopup');
if(ab)ab.addEventListener('click',function(e){
e.stopPropagation();if(ap)ap.classList.toggle('show');
});

var aiBtn=el('attachImage');
if(aiBtn)aiBtn.addEventListener('click',function(){
if(this.disabled)return;
openImageDialog();
});

var afBtn=el('attachFile');
if(afBtn)afBtn.addEventListener('click',function(){
openFileDialog();
});

var scb=el('scrollBottomBtn'),ca=el('chatArea');
if(scb)scb.addEventListener('click',scrollD);
if(ca)ca.addEventListener('scroll',function(){
var near=ca.scrollHeight-ca.scrollTop-ca.clientHeight<80;
var cm=el('chatMessages');
if(scb)scb.classList.toggle('visible',!near&&cm&&cm.style.display!=='none');
});

var sg=el('suggestionsGrid');
if(sg)sg.querySelectorAll('.suggestion-card').forEach(function(c){
c.addEventListener('click',function(){
var inp2=el('messageInput');
if(inp2){inp2.value=c.getAttribute('data-text')||'';autoR(inp2);expandInput();sendMsg()}
});
});

document.querySelectorAll('[data-theme-set]').forEach(function(b){
b.addEventListener('click',function(){setTheme(b.getAttribute('data-theme-set'))});
});

var ts=el('themeSelector');
if(ts)ts.querySelectorAll('[data-theme-val]').forEach(function(o){
o.addEventListener('click',function(){setTheme(o.getAttribute('data-theme-val'))});
});

var sBtn=el('settingsBtn');if(sBtn)sBtn.addEventListener('click',openSettings);
var scl=el('settingsCloseBtn');if(scl)scl.addEventListener('click',closeSettings);
var scanc=el('settingsCancelBtn');if(scanc)scanc.addEventListener('click',closeSettings);
var ssave=el('settingsSaveBtn');if(ssave)ssave.addEventListener('click',doSaveSettings);
var tconn=el('testConnectionBtn');if(tconn)tconn.addEventListener('click',testConn);
var sm=el('settingsModal');if(sm)sm.addEventListener('click',function(e){if(e.target===sm)closeSettings()});

var dcanc=el('deleteCancelBtn');if(dcanc)dcanc.addEventListener('click',hideDelConfirm);
var dconf=el('deleteConfirmBtn');
if(dconf)dconf.addEventListener('click',function(){
if(pendingDeleteId)doDelete(pendingDeleteId);
hideDelConfirm();
});

document.addEventListener('keydown',function(e){
if(e.key==='Escape'){
closeSettings();hideDelConfirm();
if(mdd)mdd.classList.remove('show');
if(ap)ap.classList.remove('show');
}
});
}

function openSettings(){
var ui=el('ollamaUrlInput'),pi=el('systemPromptInput'),cr=el('connectionResult');
if(ui)ui.value=state.ollamaUrl;
if(pi)pi.value=state.systemPrompt;
if(cr)cr.innerHTML='';

var sd=el('settingsStatusDot'),st=el('settingsStatusText');
if(state.connected){
if(sd)sd.className='status-dot connected';
if(st)st.textContent='Подключено';
renderSettingsModels();
}else{
if(sd)sd.className='status-dot disconnected';
if(st)st.textContent='Не подключено';
var ml=el('settingsModelsList');
if(ml)ml.innerHTML='<div class="settings-models-empty">Нет подключения</div>';
}

var ts=el('themeSelector');
if(ts)ts.querySelectorAll('[data-theme-val]').forEach(function(o){
o.classList.toggle('active',o.getAttribute('data-theme-val')===state.theme);
});

var m=el('settingsModal');if(m)m.classList.add('show');
}

function closeSettings(){var m=el('settingsModal');if(m)m.classList.remove('show')}

async function testConn(){
var ui=el('ollamaUrlInput'),cr=el('connectionResult'),tb=el('testConnectionBtn');
if(!ui)return;
var url=ui.value.trim();
if(!url){if(cr){cr.className='connection-result error';cr.textContent='Введите URL'}return}
if(cr){cr.className='connection-result';cr.textContent='...'}
if(tb)tb.disabled=true;
try{
var r=await api.ollamaPing(url);
if(tb)tb.disabled=false;
if(r&&r.success){
if(cr){cr.className='connection-result success';cr.textContent='✓ Успешно'}
state.ollamaUrl=url;await api.ollamaSetUrl(url);state.connected=true;
setStatusUI('connected','Подключено');await loadModels();renderSettingsModels();
var sd=el('settingsStatusDot'),st=el('settingsStatusText');
if(sd)sd.className='status-dot connected';if(st)st.textContent='Подключено';
}else{
if(cr){cr.className='connection-result error';cr.textContent='✗ '+(r?r.error:'Ошибка')}
}
}catch(e){
if(tb)tb.disabled=false;
if(cr){cr.className='connection-result error';cr.textContent='✗ '+e.message}
}
}

function renderSettingsModels(){
var ml=el('settingsModelsList');if(!ml)return;
if(!state.models.length){ml.innerHTML='<div class="settings-models-empty">Нет моделей</div>';return}
ml.innerHTML=state.models.map(function(m){
var caps=getCaps(m.name);
var badges='';
if(caps.vision)badges+=' <span class="feature-badge vision" style="font-size:9px;padding:1px 5px">Vision</span>';
if(caps.thinking)badges+=' <span class="feature-badge thinking" style="font-size:9px;padding:1px 5px">Think</span>';
if(caps.tools)badges+=' <span class="feature-badge tools" style="font-size:9px;padding:1px 5px">Tools</span>';
if(caps.code)badges+=' <span class="feature-badge code" style="font-size:9px;padding:1px 5px">Code</span>';
return'<div class="settings-model-item"><span class="settings-model-name">'+eh(m.name)+badges+
'</span><span class="settings-model-size">'+fmtSz(m.size)+'</span></div>';
}).join('');
}

async function doSaveSettings(){
var ui=el('ollamaUrlInput'),pi=el('systemPromptInput');
if(pi)state.systemPrompt=pi.value;
if(ui){
var url=ui.value.trim();
if(url&&url!==state.ollamaUrl){
state.ollamaUrl=url;
await api.ollamaSetUrl(url);
await autoConnect();
}
}
saveNow();closeSettings();
}

async function main(){
load();
setTheme(state.theme);
setup();
renderConvs();

var c=getActive();
if(c&&c.messages.length){showChat();renderMsgs(c.messages)}
else{state.activeConversationId=null;showWelcome()}

updateAttachOptions();
await autoConnect();
}

main();
})();