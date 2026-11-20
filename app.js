import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ACTIVE_BACKPACK, VISUAL_ASSETS, BACKPACK_PROFILE } from './viewer/physical-config.js';
import { createPackingSpace } from './viewer/packing-space.js';
import { GEAR_ASSETS } from './viewer/gear-assets.js';
import { createGearLoader } from './viewer/gear-loader.js';
import { officialWeightKg } from './viewer/product-specs.js';
import { createMetricBackpack, BACKPACK_REFERENCE } from './viewer/backpack-frame.js';
import {loadOfficialCollection,officialOptions,productReadiness}from'./viewer/official-products.js';
import {EQUIPMENT_TYPES,catalogCoverage,typeById} from './viewer/equipment-taxonomy.js';
import {brandKey,brandsFor,catalogGroups} from './viewer/catalog-filters.js';
import {catalogParameterText,catalogWeightText,catalogRestrictions,catalogEvidenceRows,primaryCatalogSource}from'./viewer/catalog-details.js';
import {loadReferenceFor}from'./viewer/backpack-load.js';
import {LUX_MODEL_PREVIEWS} from './viewer/lux-model-previews.js';
import {BACKPACK_SIZE_REFERENCE} from './viewer/reference-backpack.js';
import {readOwnedGear,saveOwnedGear}from'./viewer/owned-gear.js';
import {matchesCatalogSearch}from'./viewer/catalog-search.js';
import {localModels} from './viewer/local-models.js';

const host = document.querySelector('#viewer');
const loading = document.querySelector('#loading');
const status = document.querySelector('#status');
const spaceToggle = document.querySelector('#space-toggle');
const gearSelect = document.querySelector('#gear-preview');
const proxyToggle = document.querySelector('#gear-proxy-toggle');
const workbenchOpen = document.querySelector('#workbench-open');
const workbenchEntries = [workbenchOpen, ...document.querySelectorAll('[data-workbench-entry]')];
const buttons = [...document.querySelectorAll('.tools button'), spaceToggle, gearSelect, proxyToggle, ...workbenchEntries];

function fail(message, error) {
  console.error(message, error ?? '');
  loading.hidden = true;
  document.querySelector('#error').hidden = false;
  document.querySelector('#error-detail').textContent = message;
  status.textContent = '加载失败，请检查提示后重试';
  host.dataset.state = 'error';
  buttons.forEach(button => { button.disabled = true; });
}

async function init() {
  if (location.protocol === 'file:') throw new Error('请双击 start-demo.cmd 启动，通过 http://127.0.0.1:8080 访问网页，不要直接双击 index.html。');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.domElement.setAttribute('aria-label', 'Lux3D 徒步背包模型');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  // Scene units are meters. This is a display setting, not a measured bag height.
  let visualHeightM = BACKPACK_REFERENCE.heightM;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.0025, 25);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.minDistance = 0.375;
  controls.maxDistance = 2;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  // A local, procedural studio environment lights reflective PBR materials.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf7ffe8, 0x6c7960, 2));
  const key = new THREE.DirectionalLight(0xfff3dd, 3);
  key.position.set(3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe9f3ff, 2);
  fill.position.set(-3, 1, -3);
  scene.add(fill);

  let initialPosition = new THREE.Vector3(0.28, 0.14, 1).normalize();
  let visible = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let needsRender = true;
  let workbench;
  loadOfficialCollection().then(collection=>{
    const usableCount=collection.candidates.filter(c=>productReadiness(c,collection).available).length;
    const host=document.querySelector('#official-product-library');host.replaceChildren();
    const validOwnedIds=collection.candidates.map(c=>c.candidateId),ownedState=readOwnedGear(()=>localStorage,validOwnedIds),owned=new Set(ownedState.ids);
    let ownedOnly=false;
    const ownedNotice=document.querySelector('#owned-gear-notice');ownedNotice.textContent=ownedState.notice;
    function syncOwned(){
      document.querySelector('#owned-gear-count').textContent=String(owned.size);
      document.querySelector('#owned-gear-available').textContent=String(collection.candidates.filter(c=>owned.has(c.candidateId)&&productReadiness(c,collection).available).length);
      for(const button of host.querySelectorAll('[data-catalog-action=own]')){const yes=owned.has(button.closest('article').dataset.candidateId);button.setAttribute('aria-pressed',String(yes));button.textContent=yes?'已加入我的装备 · 取消':'＋ 加入我的装备';}
    }
    const categoryNames=Object.fromEntries(EQUIPMENT_TYPES.map(t=>[t.id,t.name]));
    const search=document.querySelector('#product-search'),category=document.querySelector('#product-category'),availability=document.querySelector('#product-availability');
    const group=document.querySelector('#product-group'),brand=document.querySelector('#product-brand');
    const groups=catalogGroups(),coverageGroups=new Map();let lastNavigationGroup='',openingProduct=false;
    const cardRevealObserver=window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches&&'IntersectionObserver'in window
      ?new IntersectionObserver(entries=>{const entering=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>{
        const vertical=a.boundingClientRect.top-b.boundingClientRect.top;return Math.abs(vertical)>2?vertical:a.boundingClientRect.left-b.boundingClientRect.left;});
        entering.forEach((entry,index)=>{const card=entry.target;card.style.setProperty('--catalog-reveal-delay',`${Math.min(index,8)*38}ms`);
        card.classList.remove('motion-pending');card.classList.add('is-revealing');
        const settle=event=>{if(event.target!==card||event.animationName!=='catalog-card-reveal')return;
          card.classList.remove('is-revealing');card.style.removeProperty('--catalog-reveal-delay');card.removeEventListener('animationend',settle);card.removeEventListener('animationcancel',settle);};
        card.addEventListener('animationend',settle);card.addEventListener('animationcancel',settle);cardRevealObserver.unobserve(card);});},
        {rootMargin:'0px 0px -6% 0px',threshold:.06})
      :null;
    for(const g of groups)group.add(new Option(g.name,g.id));
    function updateCategories(){
      const previous=category.value;category.replaceChildren(new Option('全部细类',''));
      for(const g of groups.filter(g=>!group.value||g.id===group.value)){
        const options=document.createElement('optgroup');options.label=g.name;
        for(const t of EQUIPMENT_TYPES.filter(t=>t.groupId===g.id))options.append(new Option(t.name,t.id));category.append(options);
      }
      if([...category.options].some(o=>o.value===previous))category.value=previous;
    }
    function updateBrands(){
      const previous=brand.value;brand.replaceChildren(new Option('全部品牌',''));
      for(const b of brandsFor(collection,{groupId:group.value,typeId:category.value}))brand.add(new Option(`${b.name}（${b.count}）`,b.id));
      if([...brand.options].some(o=>o.value===previous))brand.value=previous;
    }
    updateCategories();updateBrands();
    const coverage=document.querySelector('#equipment-coverage'),sourceFilter=document.querySelector('#product-source');
    for(const g of groups){const section=document.createElement('details'),summary=document.createElement('summary');summary.textContent=g.name;section.dataset.group=g.id;section.open=g.id===groups[0].id;section.append(summary);coverage.append(section);coverageGroups.set(g.id,section);}
    for(const t of catalogCoverage(collection)){
      const button=document.createElement('button');button.type='button';button.dataset.equipmentType=t.id;
      button.textContent=`${t.name} · ${t.productCount?t.productCount+'项':'待收集'}`;button.setAttribute('aria-pressed','false');
      button.onclick=()=>{group.value=t.groupId;updateCategories();category.value=t.id;brand.value='';updateBrands();search.value='';availability.value='';sourceFilter.value='';filterProducts();};coverageGroups.get(t.groupId).append(button);
    }
    async function openProduct(c,purpose='equipment'){
      const status=document.querySelector('#product-selected-status');
      const sceneState=document.querySelector('#viewer').dataset.state;
      if(sceneState!=='ready'||typeof workbenchOpen.onclick!=='function'){status.textContent=sceneState==='error'?'3D场景暂不可用，仍可查看型号资料。':'3D场景正在加载，请稍后再点击使用。';return;}
      if(openingProduct)return;openingProduct=true;
      try{await workbenchOpen.onclick();const selected=purpose==='load-reference'?await workbench?.chooseLoadReference(c.candidateId):await workbench?.chooseProduct(c.equipmentId,c.candidateId);if(!selected)throw Error('型号暂不可用');}
      catch{status.textContent='暂时无法打开此型号，请刷新后重试。';}
      finally{openingProduct=false;}
    }
    function choose(c,card,facts,info,available){
      const panel=document.querySelector('#product-selection');panel.hidden=false;panel.dataset.candidateId=c.candidateId;
      document.querySelector('#product-selected-title').textContent=`${c.identity.brand??'品牌未注明'} ${c.identity.model} · ${c.identity.size}`;
      document.querySelector('#product-selected-info').textContent=info;
      document.querySelector('#product-selected-facts').textContent=facts;
      const selectedSource=document.querySelector('#product-selected-source'),url=card.querySelector('a[data-catalog-source="primary"]')?.getAttribute('href');
      selectedSource.hidden=!url;if(url)selectedSource.href=url;else selectedSource.removeAttribute('href');
      document.querySelector('#product-selected-status').textContent=available?'已选择，可进入3D工作台；进入后点击“添加装备”。':loadReferenceFor(c)?'已选择，可用作负重参考；该型号3D外形及内仓尚未接入。':'已选择查看资料；参数或版本仍待补齐，暂不能用于3D装包。';
      const pack=document.querySelector('#product-selected-pack');pack.disabled=!available;pack.onclick=()=>openProduct(c);
      const loadButton=document.querySelector('#product-selected-load-reference');loadButton.hidden=!loadReferenceFor(c);loadButton.onclick=()=>openProduct(c,'load-reference');
      for(const other of host.children)other.classList.toggle('is-selected',other===card);
      for(const button of host.querySelectorAll('[data-catalog-action=select]'))button.setAttribute('aria-pressed',String(button.closest('article')===card));
      panel.scrollIntoView({block:'nearest'});
    }
    for(const c of collection.candidates){
      const card=document.createElement('article');card.className=`panel official-variant${cardRevealObserver?' motion-pending':''}`;
      const available=officialOptions(collection,c.equipmentId).some(o=>o.id===c.candidateId&&o.available);
      card.dataset.category=c.equipmentId;card.dataset.availability=available?'available':'reference';
      card.dataset.brand=brandKey(c.identity.brand);card.dataset.group=typeById(c.equipmentId).groupId;card.dataset.candidateId=c.candidateId;
      const title=document.createElement('h3');title.textContent=`${c.identity.brand??'品牌未注明'} ${c.identity.model} · ${c.identity.size}`;
      const text=document.createElement('p'),f=c.fields;
      const readiness=productReadiness(c,collection);
      text.textContent=`${categoryNames[c.equipmentId]} · 版本：${c.identity.version??c.identity.editionCode??'见来源'}；年份：${c.identity.officialModelYear??'暂无官方数据'}。${catalogWeightText(f.weightKg,collection)}${available?'可添加到3D，外观为程序几何示意。':'仅资料参考，缺项/版本限制见详情。'}${!available&&collection.enabledCandidateIds.includes(c.candidateId)?'参数检查未通过：'+readiness.reason+'。':''}`;
      const source=primaryCatalogSource(c,collection),link=document.createElement('a');
      card.dataset.source=source&&['品牌产品页','品牌官方文档'].includes(source.type)?'official':'retailer';card.dataset.unbranded=String(!c.identity.brand);
      card.dataset.searchAliases=c.identity.brand?'':'普通用品 无品牌 未知品牌';
      link.textContent=card.dataset.source==='official'?'查看品牌资料来源 ↗':'查看商家参考来源 ↗';link.target='_blank';link.rel='noopener noreferrer';link.dataset.catalogSource='primary';
      if(source)link.href=source.url;else link.hidden=true;
      const badge=document.createElement('span');badge.className='catalog-badge';badge.textContent=available?'支持3D装包':'仅资料参考';
      const pick=document.createElement('button');pick.type='button';pick.dataset.catalogAction='select';pick.textContent='选择此型号';pick.setAttribute('aria-pressed','false');
      card.append(badge,title,text,link);
      const categoryLabel=document.createElement('div');categoryLabel.className='catalog-category-label';categoryLabel.textContent=categoryNames[c.equipmentId];card.prepend(categoryLabel);
      const dimensions=document.createElement('details'),heading=document.createElement('summary'),facts=document.createElement('p');
      heading.textContent='尺寸、计重口径与核验日期';
      const values=Object.entries(f).filter(([key])=>/Dimensions|Length|Size|Volume|Capacity|Diameter|PerMeter|ContentWeight|PairWeight|ShoeWeight|listedProductWeight|accessoryWeight|usableInterior|mountCoordinates/.test(key)).map(([key,field])=>catalogParameterText(key,field,collection));
      facts.textContent=values.join('。')+`。计重口径：${f.weightKg.basis??'缺失或存在来源冲突'}。限制：${catalogRestrictions(c)}。收纳尺寸与展开尺寸分别记录；工程包络不是厂家碰撞模型。`;
      dimensions.append(heading,facts);card.append(dimensions);
      const loadProfile=loadReferenceFor(c);
      if(loadProfile){const loadNote=document.createElement('p');loadNote.className='catalog-load-reference';loadNote.textContent=`厂商标称负重范围 ${loadProfile.minKg}–${loadProfile.maxKg} kg · 核验 ${loadProfile.verifiedAt}。可用于重量对照，不代表已接入该型号的3D外形或内仓。`;
        const sourceLink=document.createElement('a');sourceLink.textContent='负重范围官方来源 ↗';sourceLink.href=loadProfile.sourceUrl;sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';sourceLink.dataset.catalogSource='load-range';
        const loadButton=document.createElement('button');loadButton.type='button';loadButton.dataset.catalogAction='load-reference';loadButton.textContent='用作负重参考';loadButton.onclick=()=>{choose(c,card,facts.textContent,text.textContent,available);return openProduct(c,'load-reference');};
        card.append(loadNote,sourceLink,loadButton);
      }
      // Build expanded evidence once, without changing search results when details are opened.
      const evidence=document.createElement('section');evidence.className='catalog-evidence';evidence.dataset.catalogEvidence='';
      dimensions.append(evidence);
      dimensions.addEventListener('toggle',()=>{
        if(!dimensions.open||evidence.childElementCount)return;
        const title=document.createElement('h4');title.textContent='逐项参数来源';
        const note=document.createElement('p');note.textContent='核验日期指该参数的记录；查阅日期指来源页面。打开链接不代表已重新核验。缺失项不会用商品总链接补成已知数据。';evidence.append(title,note);
        for(const row of catalogEvidenceRows(c,collection)){
          const item=document.createElement('div');item.dataset.fieldSource=row.key;
          const label=document.createElement('strong');label.textContent=row.label;item.append(label);
          const status=document.createElement('p');status.textContent=`${row.status} · 参数核验：${row.verifiedAt??'未记录'}${row.basis?' · 计重/尺寸口径：'+row.basis:''}`;item.append(status);
          const list=document.createElement('ul');
          for(const s of row.sources){const entry=document.createElement('li'),a=document.createElement('a');a.textContent=`${s.type} · ${s.host} ↗`;a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.dataset.sourceId=s.sourceId;
            entry.append(a,document.createTextNode(` · 查阅 ${s.checkedAt} · 页面位置：${s.location}`));
            const values=row.observations.filter(o=>o.sourceId===s.sourceId).map(o=>o.valueKg+' kg');if(values.length)entry.append(document.createTextNode(' · 待核对值：'+values.join(' / ')));list.append(entry);}
          if(!row.sources.length){const missing=document.createElement('li');missing.textContent='暂无该参数的可用来源链接';list.append(missing);}
          if(row.unavailableSourceCount){const invalid=document.createElement('li');invalid.textContent=`${row.unavailableSourceCount} 个来源链接无效，已停用`;list.append(invalid);}
          for(const o of row.observations.filter(o=>!o.source)){const unbound=document.createElement('li');unbound.textContent=`待核对值：${o.valueKg} kg；对应来源链接缺失或无效，不作为已核验值`;list.append(unbound);}
          item.append(list);evidence.append(item);
        }
      });
      pick.onclick=()=>choose(c,card,facts.textContent,text.textContent,available);card.append(pick);
      if(officialOptions(collection,c.equipmentId).some(o=>o.id===c.candidateId&&o.available)){
        const button=document.createElement('button');button.dataset.catalogAction='pack';button.textContent='在3D装包中选择';button.onclick=()=>{choose(c,card,facts.textContent,text.textContent,available);return openProduct(c);};card.append(button);
      }
      card.dataset.searchText=card.textContent+' '+card.dataset.searchAliases;host.append(card);
      if(cardRevealObserver)cardRevealObserver.observe(card);
      const own=document.createElement('button');own.type='button';own.dataset.catalogAction='own';
      own.onclick=()=>{if(owned.has(c.candidateId))owned.delete(c.candidateId);else owned.add(c.candidateId);
        ownedNotice.textContent=saveOwnedGear(()=>localStorage,[...owned],validOwnedIds)?'我的装备已保存在本机。拥有记录不会自动勾选行前清单或添加3D实例。':'浏览器暂不能保存，本次标记仍可使用；刷新后可能丢失。';syncOwned();filterProducts();};card.append(own);
    }
    function filterProducts(){
      const query=search.value.trim();let count=0,revealIndex=0;
      for(const card of host.children){const wasHidden=card.hidden,sourceMismatch=sourceFilter.value==='unbranded'?card.dataset.unbranded!=='true':sourceFilter.value&&card.dataset.source!==sourceFilter.value;
        card.hidden=!!((ownedOnly&&!owned.has(card.dataset.candidateId))||!matchesCatalogSearch(card.dataset.searchText,query)||(group.value&&card.dataset.group!==group.value)||(category.value&&card.dataset.category!==category.value)||(brand.value&&card.dataset.brand!==brand.value)||(availability.value&&card.dataset.availability!==availability.value)||sourceMismatch);
        if(card.hidden){card.classList.remove('is-revealing');}else{if(wasHidden&&!card.classList.contains('motion-pending')&&window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches&&typeof card.animate==='function'){
          card.animate([{opacity:0,transform:'translateY(22px) scale(.975)'},{opacity:1,transform:'translateY(0) scale(1)'}],
            {duration:560,delay:Math.min(revealIndex++,10)*38,easing:'cubic-bezier(.2,.72,.22,1)'});}
          count++;}}
      document.querySelector('#product-search-summary').textContent=query?`“${query}” · ${ownedOnly?'我的装备':'全部装备'}中找到 ${count} 项；同时应用下方筛选。`:`在${ownedOnly?'我的装备':'全部装备'}中搜索；支持多个关键词，用空格分隔。`;
      document.querySelector('#product-search-clear').disabled=!search.value;
      document.querySelector('#product-count').textContent=`显示 ${count} / ${collection.candidates.length} 项具体商品 · ${usableCount} 个可添加到3D · ${EQUIPMENT_TYPES.length}类目录（分类不计商品数）。`;
      const notice=document.querySelector('#generic-category-notice');notice.hidden=!category.value;
      const categoryHasProducts=category.value&&collection.candidates.some(c=>c.equipmentId===category.value);
      notice.textContent=category.value?`${typeById(category.value).name}：也适用于普通/无品牌用品。未记录具体物品的尺寸、重量与来源时，保持未知，不套用品牌型号或默认值。${count?'以下展示已收集商品。':categoryHasProducts?'当前筛选下暂无匹配；清除筛选可查看已收集商品。':'该类别暂无商品资料，仍待收集参数。'}`:'';
      document.querySelector('#product-empty').hidden=count>0;
      document.querySelector('#product-empty').textContent=ownedOnly?(owned.size?'我的装备中没有符合当前筛选的型号，请重置筛选。':'还没有标记拥有的装备。切换“全部装备”，在型号卡片点击“加入我的装备”。'):'没有符合条件的具体商品。可重置筛选或选择其他品牌；该分类缺少资料时不会生成虚构型号。';
      for(const button of coverage.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.equipmentType===category.value));
      if(category.value)coverageGroups.get(typeById(category.value).groupId).open=true;
      const activeGroup=category.value?typeById(category.value).groupId:group.value;
      if(activeGroup&&activeGroup!==lastNavigationGroup){const section=coverageGroups.get(activeGroup);section.open=true;coverage.scrollTop+=section.getBoundingClientRect().top-coverage.getBoundingClientRect().top;}
      if(!activeGroup&&lastNavigationGroup)coverage.scrollTop=0;lastNavigationGroup=activeGroup;
    }
    document.querySelector('#product-clear-selection').onclick=()=>{document.querySelector('#product-selection').hidden=true;delete document.querySelector('#product-selection').dataset.candidateId;host.querySelectorAll('article').forEach(card=>card.classList.remove('is-selected'));host.querySelectorAll('[data-catalog-action=select]').forEach(button=>button.setAttribute('aria-pressed','false'));};
    for(const button of document.querySelectorAll('[data-owned-view]'))button.onclick=()=>{ownedOnly=button.dataset.ownedView==='mine';for(const other of document.querySelectorAll('[data-owned-view]'))other.setAttribute('aria-pressed',String(other===button));document.querySelector('#product-clear-selection').click();filterProducts();};
    syncOwned();
    document.querySelector('#product-search-form').onsubmit=event=>{event.preventDefault();filterProducts();document.querySelector('#product-count').scrollIntoView({block:'nearest'});};
    document.querySelector('#product-search-clear').onclick=()=>{search.value='';filterProducts();search.focus();};
    for(const button of document.querySelectorAll('[data-search-example]'))button.onclick=()=>{search.value=button.dataset.searchExample;filterProducts();search.focus();};
    search.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();search.value='';filterProducts();}});
    document.querySelector('#reference-gear-jump').onclick=()=>document.querySelector('#reference-gear').scrollIntoView({block:'start'});
    document.querySelector('#product-reset').onclick=()=>{group.value='';category.value='';brand.value='';search.value='';availability.value='';sourceFilter.value='';updateCategories();updateBrands();filterProducts();};
    group.addEventListener('change',()=>{category.value='';updateCategories();updateBrands();filterProducts();});
    category.addEventListener('change',()=>{updateBrands();filterProducts();});
    search.addEventListener('input',filterProducts);brand.addEventListener('change',filterProducts);availability.addEventListener('change',filterProducts);sourceFilter.addEventListener('change',filterProducts);filterProducts();
  }).catch(()=>{document.querySelector('#official-product-library').textContent='型号资料暂不可用，原装备库与清单仍可使用。';});
  controls.addEventListener('change', () => { needsRender = true; });
  function reset() {
    // Clear any remaining orbit damping before restoring the initial view.
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(initialPosition);
    controls.target.set(0, 0, 0);
    controls.update();
    controls.enableDamping = true;
    needsRender = true;
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    visible = width > 0 && height > 0;
    if (!visible || (width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    // Frame the whole bag on both narrow and wide screens.
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const fit = visualHeightM * 0.575 / Math.sin(Math.atan(Math.tan(halfFov) * Math.min(camera.aspect, 1)));
    initialPosition = new THREE.Vector3(0.28, 0.14, 1).normalize().multiplyScalar(fit);
    controls.maxDistance = Math.max(2, fit * 2);
    reset();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) return;
    workbench?.update();
    const changed = controls.enabled ? controls.update() : false;
    if (changed || needsRender) {
      renderer.render(scene, camera);
      needsRender = false;
    }
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    workbench?.close();
    fail('浏览器的 3D 渲染已中断。请点击重新加载；若反复发生，请检查浏览器硬件加速设置。');
  });

  const loader = new GLTFLoader();
  let backpackModel;
  let usingIllustration = false;
  let primaryLuxPreview = null;
  try {
    const modelModule = await import('./viewer/lux-backpack-preview.js');
    if (localModels[modelModule.LUX_BACKPACK_PREVIEW.modelUrl] === false) throw Error('本机未提供Kestrel Lux3D模型');
    primaryLuxPreview = await modelModule.loadLuxBackpackPreview(loader);
    backpackModel = primaryLuxPreview.group;
  } catch (error) {
    console.warn('Kestrel Lux3D 主背包外观不可用，尝试原匿名模型。', error);
    try {
      if (localModels[VISUAL_ASSETS[ACTIVE_BACKPACK.visualAssetId].modelUrl.replace(/^\.\//, '')] === false) throw Error('本机未提供原匿名背包GLB');
      backpackModel = (await loader.loadAsync(VISUAL_ASSETS[ACTIVE_BACKPACK.visualAssetId].modelUrl)).scene;
    } catch (legacyError) {
      console.warn('匿名背包模型也不可用，切换为简化示意。', legacyError);
      const { createReferenceBackpack } = await import('./viewer/reference-backpack.js');
      backpackModel = createReferenceBackpack().appearance;
      usingIllustration = true;
    }
  }
  const backpackLabel = usingIllustration ? '简化背包示意' : primaryLuxPreview ? 'Osprey Kestrel 38 S23 · Lux3D 外观近似' : '匿名 Lux3D 背包模型';
  const backpackSource = usingIllustration ? '程序示意' : primaryLuxPreview ? 'Lux3D · Kestrel 38 S23 外观近似' : 'Lux3D 匿名模型';
  let visualReference = BACKPACK_REFERENCE;
  if (usingIllustration) {
    const bounds = new THREE.Box3().setFromObject(backpackModel).getSize(new THREE.Vector3());
    bounds.multiplyScalar(BACKPACK_REFERENCE.heightM / bounds.y);
    visualReference = { ...BACKPACK_REFERENCE, sizeM: bounds, source: '程序示意外观' };
  }
  let pivot, appearance;
  if(primaryLuxPreview){
    appearance=backpackModel;appearance.name='backpack-appearance';pivot=new THREE.Group();pivot.name='backpack-meter-frame';pivot.add(appearance);
    pivot.userData={...BACKPACK_REFERENCE,unit:'m',dataStatus:'demo',source:'Lux3D Kestrel 38 S23 generated appearance; height-only scale, width/depth mismatch; demo packing space remains independent',rawSize:appearance.userData.rawSize,modelScaleToMeters:appearance.scale.x,exteriorSizeM:appearance.userData.worldSize,targetExteriorSizeM:[BACKPACK_SIZE_REFERENCE.sizeM.x,BACKPACK_SIZE_REFERENCE.sizeM.y,BACKPACK_SIZE_REFERENCE.sizeM.z],originDefinition:'visual-AABB-center; not a measured main-compartment origin',interiorAlignmentStatus:'demo-region-not-mesh-validated'};
  }else ({ frame: pivot, appearance } = createMetricBackpack(backpackModel, visualReference));
  scene.add(pivot);
  // A separate metric proxy; its size does not come from the GLB bounding box.
  const packingSpace = createPackingSpace();
  document.querySelector('#space-note').textContent = `分段截面近似 · 轮廓外包尺寸 ${Object.values(BACKPACK_PROFILE.interior.regions[0].sizeM).join(' × ')} m（宽 × 高 × 深），非实测。可放置范围采用同一分段凸轮廓，非规则盒或真实容量。`;
  pivot.add(packingSpace.group); // Same meter frame as appearance/attachment points; no GLB scale inherited.
  spaceToggle.onclick = () => {
    const visible = !packingSpace.group.visible;
    packingSpace.setVisible(visible);
    spaceToggle.setAttribute('aria-pressed', String(visible));
    spaceToggle.textContent = visible ? '隐藏模拟空间' : '显示模拟空间';
    needsRender = true;
  };
  const loadGear = createGearLoader(loader);
  const gearModels = new Map();
  const luxPreviewId='backpack';let luxPreviewPromise=primaryLuxPreview?Promise.resolve(primaryLuxPreview):null;
  const firstAidPreviewId='lux-lifesystems-trek-first-aid-preview';let firstAidPreviewPromise=null;
  if(primaryLuxPreview)gearModels.set('backpack',primaryLuxPreview);
  function ensureLuxPreview(){
    luxPreviewPromise??=import('./viewer/lux-backpack-preview.js').then(m=>{
      if (localModels[m.LUX_BACKPACK_PREVIEW.modelUrl] === false) throw Error('本机未提供Lux3D背包GLB');
      return m.loadLuxBackpackPreview(loader);
    }).then(result=>{
      result.group.visible=false;if(!result.group.parent)scene.add(result.group);gearModels.set(luxPreviewId,result);return result;
    }).catch(error=>{luxPreviewPromise=null;throw error;});
    return luxPreviewPromise;
  }
  function ensureFirstAidPreview(){
    firstAidPreviewPromise??=import('./viewer/lux-first-aid-preview.js').then(m=>{
      if (localModels[m.LUX_FIRST_AID_PREVIEW.modelUrl] === false) throw Error('本机未提供LifeSystems Trek急救包GLB');
      return m.loadLuxFirstAidPreview(loader);
    }).then(result=>{
      result.group.visible=false;scene.add(result.group);gearModels.set(firstAidPreviewId,result);return result;
    }).catch(error=>{firstAidPreviewPromise=null;throw error;});
    return firstAidPreviewPromise;
  }
  const gearNote = document.querySelector('#gear-preview-note');
  // Generate menu from data: adding an asset never requires changing HTML or packing code.
  gearSelect.replaceChildren(new Option(primaryLuxPreview?`${backpackLabel} · 默认主背包`:`${backpackLabel} · 当前主背包`, 'backpack'));
  for (const asset of GEAR_ASSETS) gearSelect.add(new Option(`${asset.name} · 加载中`, asset.id));
  gearSelect.add(new Option('LifeSystems Trek 急救包 · Lux3D 外观预览',firstAidPreviewId));
  for(const definition of LUX_MODEL_PREVIEWS)gearSelect.add(new Option(`${definition.name} · 外观预览`,definition.id));
  // All loads settle independently; one gear failure cannot break other assets/planning.
  await Promise.all(GEAR_ASSETS.map(async asset => {
    const result = await loadGear(asset);
    result.group.visible = false;
    scene.add(result.group);
    gearModels.set(asset.id, result);
    gearSelect.querySelector(`option[value="${asset.id}"]`).textContent =
      `${asset.name} · ${result.asset.modelStatus === 'ready' ? 'GLB 预览' : '演示临时模型'}`;
  }));
  if(primaryLuxPreview)gearSelect.value='backpack';
  function updateProxy() {
    const selected = gearModels.get(gearSelect.value);
    proxyToggle.disabled = !selected?.collisionProxy;
    for (const [id, result] of gearModels) {
      if (result.collisionProxy) result.collisionProxy.visible = id === gearSelect.value && proxyToggle.getAttribute('aria-pressed') === 'true';
    }
    needsRender = true;
  }
  proxyToggle.onclick = () => {
    const show = proxyToggle.getAttribute('aria-pressed') !== 'true';
    proxyToggle.setAttribute('aria-pressed', String(show));
    proxyToggle.textContent = show ? '隐藏装备代理' : '显示装备代理';
    updateProxy();
  };
  gearSelect.onchange = () => {
    const luxPreview=LUX_MODEL_PREVIEWS.find(item=>item.id===gearSelect.value);
    if(luxPreview&&!gearModels.has(luxPreview.id)){
      gearNote.textContent=`正在加载 ${luxPreview.name}…`;
      import('./viewer/lux-model-previews.js').then(async module=>{
        if(localModels[luxPreview.modelUrl]===false)throw Error('此文件未包含在本机目录');
        return module.loadLuxModelPreview(loader,luxPreview);
      }).then(result=>{result.group.visible=false;scene.add(result.group);gearModels.set(luxPreview.id,result);if(gearSelect.value===luxPreview.id)gearSelect.onchange();})
        .catch(()=>{if(gearSelect.value===luxPreview.id){gearSelect.value='backpack';gearSelect.onchange();gearNote.textContent=`${luxPreview.name}暂时无法加载，已恢复主背包外观；装包数据不变。`;}});
      return;
    }
    if(gearSelect.value===firstAidPreviewId&&!gearModels.has(firstAidPreviewId)){
      gearNote.textContent='正在加载 LifeSystems Trek 急救包外观模型…';
      ensureFirstAidPreview().then(()=>{if(gearSelect.value===firstAidPreviewId)gearSelect.onchange();})
        .catch(()=>{if(gearSelect.value===firstAidPreviewId){gearSelect.value='first-aid-kit';gearSelect.onchange();gearNote.textContent='急救包外观模型暂时无法加载，已恢复尺寸代理预览；装包模型与数据不变。';}});
      return;
    }
    if(primaryLuxPreview&&gearSelect.value===luxPreviewId&&!gearModels.has(luxPreviewId)){
      gearNote.textContent='正在加载新生成的Lux3D背包（约15.7MB），不改变装包数据…';
      ensureLuxPreview().then(()=>{if(gearSelect.value===luxPreviewId)gearSelect.onchange();})
        .catch(()=>{if(gearSelect.value===luxPreviewId){gearSelect.value='backpack';gearSelect.onchange();gearNote.textContent='新Lux3D背包暂时无法加载，已恢复原模型；可重新选择重试，装包数据不变。';}});
      return;
    }
    appearance.visible = true;
    const isBackpack = gearSelect.value === 'backpack';
    pivot.visible = isBackpack;
    packingSpace.setVisible(isBackpack && spaceToggle.getAttribute('aria-pressed') === 'true');
    spaceToggle.disabled = !isBackpack;
    for (const [id, result] of gearModels) result.group.visible = id === gearSelect.value;
    const selected = gearModels.get(gearSelect.value);
    updateProxy();
    const title = document.querySelector('.viewer-bottom h2');
    if (selected) title.textContent = selected.asset.name;
    else title.innerHTML = '徒步背包 <span>01</span>';
    document.querySelector('.viewer-top .tag').textContent = selected ? `装备 / ${selected.asset.name}` : '装备 / 背包';
    host.setAttribute('aria-label', `${selected?.asset.name ?? '3D 背包'}。鼠标拖动旋转，滚轮缩放；也可使用下方按钮。`);
    document.querySelector('.viewer-top .source').textContent = selected?.asset.previewKind==='lifesystems-trek-first-aid'?'Lux3D · 急救包外观预览':selected?.asset.previewOnly?(selected.asset.sourceLabel??'Lux3D · 外观预览'):isBackpack ? backpackSource :
      selected.asset.modelStatus === 'ready' ? '装备 GLB · 收纳参考尺寸' : 'Three.js 临时几何体';
    renderer.domElement.setAttribute('aria-label', selected ? selected.asset.name + ' 3D 预览' : backpackLabel);
    if(selected?.asset.previewKind==='lifesystems-trek-first-aid'){
      gearNote.textContent=`Lux3D生成的闭合急救包外观。按商品资料的 140 mm 最长边作等比显示，预览包围盒约 ${selected.worldSize.map(n=>(n*100).toFixed(1)).join(' × ')} cm（源模型 X×Y×Z）。商品尺寸资料为 140 × 110 × 50 mm，但轴向和模型三轴比例尚未核准；此模型只用于外观查看，不进入工作台、碰撞或容量计算。`;
      gearNote.dataset.modelStatus='visual-only';visualHeightM=0.14;
    }else if(selected?.asset.previewOnly){
      gearNote.textContent=selected.asset.note??`Lux3D按Kestrel38 S23黑色商品图生成，非官方精确模型。按参考高度79cm等比显示，当前外包尺寸（宽×高×深）${selected.worldSize.map(n=>(n*100).toFixed(1)).join(' × ')}cm；宽深与官方参数不符，仅供外观预览，不参与内仓、碰撞或容量统计。工作台仍使用官方外部尺寸示意。`;
      gearNote.dataset.modelStatus='visual-only';visualHeightM=1.1;
    }else if (selected) {
      const { asset } = selected;
      const size = asset.packedSizeM;
      const officialWeight = officialWeightKg(asset.productSpec);
      const state = { placeholder: '临时模型已就绪', ready: 'GLB 已按收纳参考等比校准（非官方核验）', fallback: 'GLB 不可用或形态不符，已回退收纳临时模型' }[asset.modelStatus];
      gearNote.textContent = `${asset.category} · ${state} · ${size ? `${size.x} × ${size.y} × ${size.z} m（宽 × 高 × 深）` : '收纳尺寸未知，碰撞代理不可用'} · ${asset.dataLevel === 'demo' ? '演示数据，非实测，不作为真实容量依据' : '尺寸来源：' + asset.source}。重量${officialWeight === null ? '未知（暂无官方数据）' : officialWeight + ' kg（官方资料）'}。来源：${asset.source}。代理：${asset.collisionShape === 'box' ? '长方体' : '圆柱体'}，尚未进行碰撞检测。仅供预览，尚不支持放入背包。`;
      gearNote.dataset.modelStatus = asset.modelStatus;
      // Common meter scale on preview switching; never enlarge each item to fill the frame.
      visualHeightM = BACKPACK_REFERENCE.heightM;
    } else {
      gearNote.textContent = '可切换 8 件装备查看收纳示意与独立代理；尺寸均为演示数据，非实测，不作为真实容量依据。';
      delete gearNote.dataset.modelStatus;
      visualHeightM = BACKPACK_REFERENCE.heightM;
    }
    controls.minDistance = visualHeightM * 0.75;
    lastWidth = 0;
    resize();
  };
  reset();
  document.querySelector('#reset').onclick = reset;
  function zoom(factor) {
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }
  document.querySelector('#zoom-in').onclick = () => zoom(0.8);
  document.querySelector('#zoom-out').onclick = () => zoom(1.25);
  buttons.forEach(button => { button.disabled = false; });
  updateProxy();
  let previousPreview = 'backpack';
  workbenchOpen.onclick = async () => {
    const errorNote = document.querySelector('#workbench-error');
    errorNote.hidden = true;
    workbenchEntries.forEach(button => { button.disabled = true; });
    try {
      if (!workbench) {
        const { createPackingWorkbench } = await import('./viewer/packing-workbench.js');
        const {createReferenceBackpack,REFERENCE_BACKPACK_PROFILE,BACKPACK_SIZE_REFERENCE,REFERENCE_INTERIOR_VOLUME_L}=await import('./viewer/reference-backpack.js');
        let referenceBag;
        if(REFERENCE_BACKPACK_PROFILE.workbenchAppearance==='lux3d-58475'){
          try{const module=await import('./viewer/lux-backpack-preview.js');referenceBag=module.cloneLuxBackpackForWorkbench(await ensureLuxPreview());}
          catch{referenceBag=createReferenceBackpack(backpackModel);referenceBag.loadFailed=true;}
        }else referenceBag=createReferenceBackpack(backpackModel);
        const referenceAppearance=referenceBag.appearance;
        referenceAppearance.visible=false;pivot.add(referenceAppearance);
        const externalNote=document.querySelector('#wb-exterior-reference');
        document.querySelector('#wb-exterior-summary').textContent=`${referenceBag.isLux3D?'Lux3D背包 · ':''}尺寸参考 ${['y','x','z'].map(a=>Math.round(BACKPACK_SIZE_REFERENCE.sizeM[a]*100)).join(' × ')} cm（高×宽×深） · 来源说明`;
        externalNote.textContent=`外部尺寸参考：${BACKPACK_SIZE_REFERENCE.name}，${['y','x','z'].map(a=>Math.round(BACKPACK_SIZE_REFERENCE.sizeM[a]*100)).join(' × ')} cm（高×宽×深），核验 ${BACKPACK_SIZE_REFERENCE.verifiedAt}。${referenceBag.isLux3D?'Lux3D资产58475生成外观，按79cm高等比显示，网格宽深与官方尺寸不一致；不是官方精确模型。':referenceBag.loadFailed?'Lux3D模型加载失败，已回退简化尺寸示意。':'简化示意外观。'}内仓/挂点仍为演示，非真实装载验证。旧匿名背包方案保留，但不直接套用到此尺寸方案。 `;
        const sourceLink=document.createElement('a');sourceLink.href=BACKPACK_SIZE_REFERENCE.sourceUrl;sourceLink.target='_blank';sourceLink.rel='noreferrer';sourceLink.textContent='官方尺寸来源 ↗';externalNote.append(sourceLink);
        const legacyFrameData=pivot.userData;
        const legacySpaceNote=document.querySelector('#space-note').textContent;
        workbench = createPackingWorkbench({ scene, camera, renderer, orbit: controls,
          backpack: referenceAppearance,backpackProfile:REFERENCE_BACKPACK_PROFILE, backpackFrame: pivot, packingSpace, loadGear, invalidate: () => { needsRender = true; },
          enterView() {
            previousPreview = gearSelect.value;
            gearSelect.value = 'backpack'; gearSelect.onchange();
            packingSpace.setDefinition(REFERENCE_BACKPACK_PROFILE.interior.regions[0]);
            document.querySelector('#space-note').textContent=`主包体留边的分段主仓近似 · ${REFERENCE_INTERIOR_VOLUME_L?.toFixed(2)??'未知'}L演示几何，不含外袋，非官方实测容量。`;
            appearance.visible=false;appearance.name='legacy-backpack-appearance';referenceAppearance.name='backpack-appearance';referenceAppearance.visible=true;
            pivot.userData={...legacyFrameData,variantId:REFERENCE_BACKPACK_PROFILE.variantId,attachmentProfile:REFERENCE_BACKPACK_PROFILE,
              exteriorSizeM:referenceBag.worldSize??Object.values(BACKPACK_SIZE_REFERENCE.sizeM),targetExteriorSizeM:Object.values(BACKPACK_SIZE_REFERENCE.sizeM),geometryStatus:referenceBag.isLux3D?'lux3d-generated-approximation':'procedural-illustration',externalSizeReference:BACKPACK_SIZE_REFERENCE};
            pivot.userData.rawSize=referenceAppearance.userData.rawSize??null;pivot.userData.modelScaleToMeters=referenceBag.isLux3D?referenceAppearance.scale.x:1;pivot.userData.source=referenceBag.isLux3D?'https://lux3d.aholo3d.cn/workspace/image-to-3d?assetId=58475':BACKPACK_SIZE_REFERENCE.sourceUrl;
            document.querySelector('.viewer-top .source').textContent=referenceBag.isLux3D?'Lux3D · Kestrel 38 S23 · 生成近似外观':referenceBag.loadFailed?'Lux3D加载失败 · 尺寸示意回退':'官方外部尺寸 · 程序示意（非Lux3D）';renderer.domElement.setAttribute('aria-label',referenceBag.isLux3D?'Lux3D生成的Osprey Kestrel 38 S23背包外观':'官方外部尺寸参考的简化背包示意');
            visualHeightM = 1.1; controls.minDistance = 0.25;
            lastWidth = 0; resize();
          },
          leaveView() {
            packingSpace.setDefinition(BACKPACK_PROFILE.interior.regions[0]);
            document.querySelector('#space-note').textContent=legacySpaceNote;
            referenceAppearance.visible=false;referenceAppearance.name='reference-backpack-appearance';appearance.name='backpack-appearance';pivot.userData=legacyFrameData;
            gearSelect.value = previousPreview; gearSelect.onchange();
          },
        });
      }
      await workbench.open();
    } catch (error) {
      errorNote.textContent = '装包工作台暂时无法打开：' + error.message + '。探索预览仍可使用，请刷新后重试。';
      errorNote.hidden = false;
    } finally { workbenchEntries.forEach(button => { button.disabled = host.dataset.state !== 'ready'; }); }
  };
  for (const button of workbenchEntries.slice(1)) button.onclick = async () => {
    let trip;
    if(button.hasAttribute('data-trip-packing-entry')){
      try{trip=(await import('./planner.js')).preparePackingPlan();}
      catch(error){const note=document.querySelector('#workbench-error');note.hidden=false;note.textContent='行程暂时无法交接：'+error.message;return;}
    }
    await workbenchOpen.onclick();
    if(button.hasAttribute('data-full-suite-demo')&&document.querySelector('#packing-workbench').open){
      try{await workbench.playDemoSuite();}
      catch(error){const note=document.querySelector('#wb-product-note');if(note)note.textContent='整套装载演示未能启动：'+error.message;}
      return;
    }
    if(trip&&document.querySelector('#packing-workbench').open){
      try{
        const kit=await workbench.beginTrip(trip);
        if(button.hasAttribute('data-auto-trip-packing-entry')){
          const result=await workbench.autoArrange(kit.instanceIds);
          if(result)document.querySelector('#wb-trip-message').textContent=`已按携带选择装载：${result.placed.length}件已装载（含优化布局），${result.unplaced.length}件待调整。手动确认装备保持原位，未选草稿保持待放；未更改清单准备勾选。未建模物品请在下方核对。`;
        }
      }catch(error){const note=document.querySelector('#wb-trip-message');document.querySelector('#wb-trip-context').hidden=false;note.textContent='带入失败：'+error.message+'。已有装备保留，可重试。';}
    }
    if(button.hasAttribute('data-plan-history-entry')&&document.querySelector('#packing-workbench').open){const plans=document.querySelector('#wb-plans');plans.open=true;plans.scrollIntoView({block:'nearest'});document.querySelector('#wb-history').focus();}
  };
  loading.hidden = true;
  document.querySelector('.viewer-top .source').textContent = backpackSource;
  renderer.domElement.setAttribute('aria-label', backpackLabel);
  status.textContent = usingIllustration ? '简化示意 · 可旋转和缩放' : '模型已就绪 · 自由探索每个角度';
  host.dataset.state = 'ready';
}

init().catch(error => fail(
  location.protocol === 'file:' ? error.message : '请确认 assets/backpack.glb 和 vendor 文件夹完整，并使用支持 WebGL 2 的现代浏览器。可刷新重试；详细原因见浏览器控制台。', error
));
