import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createAlignmentTools } from './backpack-alignment.js';
import { WORKBENCH_ASSETS as BASE_ASSETS } from './gear-assets.js';
import { evaluatePlacement, findDraftOverlaps } from './packing-collision.js';
import { summarizeSpace } from './packing-metrics.js';
import { summarizeWeights } from './product-specs.js';
import { anchorPose, anchorById, compatibleAnchors, attachmentConflicts, attachmentProfileOf } from './external-placement.js';
import { createMountGuide } from './mount-guides.js';
import { ATTACHMENT_TYPE_LABELS } from './backpack-attachments.js';

import { compileInteriorProfile } from './interior-profile.js';
import { BACKPACK_PROFILE } from './physical-config.js';
import { protectPhysicalShape, localPose, applyLocalPose, setWorldPose } from './physical-transforms.js';
import { instanceBinding } from './physical-data.js';
import { loadOfficialCollection, officialOptions, officialAsset, catalogRuntimeAssets } from './official-products.js';
import { PLAN_KEY, makePlan, readPlan, assetFingerprint } from './packing-plans.js';
import {readHistory,savePlanHistory,historyPlan,removeHistory,HISTORY_LIMIT}from'./plan-history.js';
import { autoPack } from './auto-packing.js';
import {guidedAutoPack} from './guided-packing.js';
import {preparedModels,plannedKit}from'./planner-bridge.js';
import {typeById} from './equipment-taxonomy.js';
import {loadReferenceFor,weightProgress,readLoadPreference,writeLoadPreference} from './backpack-load.js';
import {createPackingEffects} from './packing-effects.js';
import {createAutoPlayback} from './auto-playback.js';
import {createBackpackView} from './backpack-view.js';

const START = { positionM: { x: 0.28, y: 0, z: 0 }, rotationRad: { x: 0, y: 0, z: 0 } };

// Uses the app's scene/canvas/loop. Packing plans have isolated storage; planner state is read-only.
export function createPackingWorkbench({ scene, camera, renderer, orbit, backpack, backpackFrame = backpack, packingSpace, loadGear, invalidate, enterView, leaveView,backpackProfile=BACKPACK_PROFILE }) {
  const GEAR_ASSETS=[...BASE_ASSETS];
  const mountProfile=backpackProfile,mountAnchors=mountProfile.attachments;
  const dialog = document.querySelector('#packing-workbench');
  const shell = document.querySelector('.viewer-shell');
  const home = shell.parentElement;
  const anchor = document.createComment('3D preview home');
  home.insertBefore(anchor, shell);
  const canvas = renderer.domElement;
  const q = id => dialog.querySelector('#wb-' + id);
  const backpackView = createBackpackView(backpack);
  let transform = null, helper = null, item = null;
  const instances = new Map();
  const pendingReasons = new Map();
  let pendingSignature = '';
  function updatePending() {
    for(const id of pendingReasons.keys())if(!instances.has(id)||instances.get(id).committed)pendingReasons.delete(id);
    const pending=[...instances.values()].filter(record=>!record.committed);
    const disabled=planOperation||loading||restoring;
    const signature=JSON.stringify([disabled,pending.map(r=>[r.instanceId,r.asset.name,pendingReasons.get(r.instanceId)])]);
    q('pending').hidden=!pending.length;
    if(signature===pendingSignature)return;
    pendingSignature=signature;
    q('pending-items').replaceChildren(...pending.map(record=>{
      const row=document.createElement('li'),name=document.createElement('strong'),reason=document.createElement('p'),button=document.createElement('button');
      name.textContent=`${record.asset.name} · ${record.instanceId.replace('gear-','')}号`;
      reason.textContent=pendingReasons.has(record.instanceId)?`上次自动装包：${pendingReasons.get(record.instanceId)}`:'尚未确认放置，可选中后调整位置。';
      button.type='button';button.textContent='调整';button.disabled=disabled;
      button.setAttribute('aria-label',`调整${name.textContent}`);
      button.onclick=()=>{if(planOperation||loading||restoring)return;setBackpackView('inside');select(record.instanceId);};
      row.append(name,button,reason);return row;
    }));
  }
  let savedInstances = [], nextInstance = 1;
  let active = false, editing = false, loading = false, restoring = false, generation = 0;
  let openReady=Promise.resolve();
  let tripSelectedId=null;
  let inputError = '';
  function loadFeedback(message,kind='info'){
    const node=q('load-result');node.hidden=!message;node.textContent=message;node.dataset.state=kind;
  }
  let anchorMarkers = null, lastFrameMatrix = null, alignmentTools = null;
  let officialCollection=null;
  const loadReferenceIds=()=>officialCollection?.candidates.filter(c=>loadReferenceFor(c)).map(c=>c.candidateId)??[];
  let planOperation=false;
  let autoController=null,autoUndo=null;
  let assistTimer=null,assistScope=null;
  function scheduleAssist(){
    clearTimeout(assistTimer);
    if(!q('assist').checked||!active||planOperation||loading||restoring)return;
    assistTimer=setTimeout(()=>{if(active&&!planOperation&&!loading&&!restoring&&!transform?.dragging)runAutoPacking(assistScope?[...assistScope].filter(id=>instances.has(id)):null);},400);
  }
  function markUserAdjusted(){if(item){item.userAdjusted=true;item.placementOwner='manual';}}
  q('assist').onchange=()=>{clearTimeout(assistTimer);if(q('assist').checked)scheduleAssist();else autoController?.abort();};
  let effects=null;
  let playback=null;
  function playbackState(s){
    const busy=loading||restoring||planOperation||['playing','paused'].includes(s.state),autoAdd=q('auto-add');
    if(autoAdd.disabled!==busy)autoAdd.disabled=busy;
    q('import-checklist').disabled=busy;
    q('playback').hidden=s.state==='idle'||s.state==='calculating'&&!s.total;q('playback').dataset.state=s.state;
    q('playback-progress').value=s.progress;q('playback-pause').disabled=!['playing','paused'].includes(s.state);
    q('playback-pause').textContent=s.state==='paused'?'继续':'暂停';q('playback-pause').setAttribute('aria-pressed',String(s.state==='paused'));
    q('playback-skip').disabled=!['playing','paused'].includes(s.state);q('playback-replay').disabled=!s.canReplay||planOperation;
    const message=s.state==='calculating'?'正在准备装载。':s.state==='completed'?`装载完成 · ${s.total} 件${s.reduced?'（减少动画）':''}。`:
      `${s.state==='paused'?'已暂停':'正在装载'} ${Math.min(s.done+1,s.total)}/${s.total} · ${s.currentName}${s.phase?' · '+s.phase:''}；路径为示意，未验证真实包口通行。`;
    if(q('playback-message').textContent!==message)q('playback-message').textContent=message;
    invalidate();
  }
  let resumeAfterVisibility=false;
  const visibilityChange=()=>{
    if(document.hidden){resumeAfterVisibility=playback?.status.state==='playing';if(resumeAfterVisibility)playback.pause();}
    else if(resumeAfterVisibility){resumeAfterVisibility=false;playback?.resume();}
  };
  const motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionChange=()=>{q('reduce-motion').checked=motionPreference.matches;effects?.setReduced(motionPreference.matches);playback?.setReduced(motionPreference.matches);invalidate();};
  q('reduce-motion').checked=motionPreference.matches;
  q('reduce-motion').onchange=()=>{effects?.setReduced(q('reduce-motion').checked);playback?.setReduced(q('reduce-motion').checked);invalidate();};
  q('playback-pause').onclick=()=>playback?.status.state==='paused'?playback.resume():playback?.pause();
  q('playback-skip').onclick=()=>playback?.skip();
  q('playback-replay').onclick=()=>{effects?.settle();try{playback?.replay();}catch{playback?.invalidate();sync('布局仍保留，暂时无法播放动画。');}};
  function updateProductOptions() {
    q('product').replaceChildren();
    if(!GEAR_ASSETS.find(a=>a.id===q('equipment').value)?.catalogOnly)q('product').add(new Option('演示装备（非真实型号）',''));
    for(const o of officialCollection?officialOptions(officialCollection,q('equipment').value):[]){
      const option=new Option(o.name+(o.available?'':' · '+o.reason),o.id);option.disabled=!o.available;q('product').add(option);
    }
    q('product').onchange?.();
  }
  const officialReady=loadOfficialCollection().then(c=>{
    const extra=catalogRuntimeAssets(c,BASE_ASSETS);GEAR_ASSETS.push(...extra);
    for(const asset of extra)q('equipment').add(new Option(typeById(asset.id).name,asset.id));
    planContext.equipmentIds=GEAR_ASSETS.map(a=>a.id);officialCollection=c;updateProductOptions();
    for(const candidate of c.candidates){if(!loadReferenceFor(candidate))continue;
      q('load-reference').add(new Option(`${candidate.identity.brand} ${candidate.identity.model} · ${candidate.identity.size}`,candidate.candidateId));}
    const preference=readLoadPreference(()=>localStorage,loadReferenceIds());q('load-reference').value=preference.candidateId;
    q('load-preference-note').textContent=preference.notice;q('load-preference-note').hidden=!preference.notice;
    if(active)sync();
  }).catch(()=>{q('product-note').textContent='型号资料暂不可用，可继续使用原演示装备。';});
  const planContext={backpackVariantId:backpackProfile.variantId,interiorModelId:backpackProfile.interior.interiorModelId,
    equipmentIds:GEAR_ASSETS.map(a=>a.id),anchorIds:mountAnchors.map(a=>a.id)};
  q('equipment').onchange=updateProductOptions;
  q('load-reference').onchange=()=>{
    const saved=writeLoadPreference(()=>localStorage,q('load-reference').value,loadReferenceIds());
    q('load-preference-note').textContent=saved?'参考选择已保存在本机；不更换3D背包。':'当前浏览器无法保存参考选择，本次仍可使用。';
    q('load-preference-note').hidden=false;sync();
  };
  q('product').onchange=()=>{q('product-note').textContent=q('product').value?'官方型号参数 + 程序几何示意；收纳包络与背包内仓仍可能是近似，非真实装载认证。':'演示装备，尺寸与重量核验状态独立；不冒充真实产品。';};
  q('import-checklist').onclick=async()=>{
    if(loading||restoring||planOperation||['playing','paused'].includes(playback?.status.state))return;
    clearTimeout(assistTimer);const added=[];
    planOperation=true;sync();
    try{const ids=preparedModels(localStorage.getItem('shanxing3d:planner:v1')),fresh=ids.filter(id=>![...instances.values()].some(r=>r.equipmentId===id));
      if(instances.size+fresh.length>100)throw Error('场景装备过多，请先移除不需要的实例');
      for(const id of fresh){q('equipment').value=id;updateProductOptions();const record=await add(id);if(record)added.push(record);}
      q('product-note').textContent=`从清单添加${added.length}类已准备装备（演示型号）；已有类别不重复添加。${fresh.length-added.length?`${fresh.length-added.length}类添加失败，可重试。`:''}其余清单物品暂无模型；不会自动勾选准备状态。`;
      if(!added.length)loadFeedback('没有新增可装载装备；已有类别保持不变。');
    }catch(e){q('product-note').textContent=e.message;loadFeedback('清单未能导入，请先生成并勾选已准备物品。','warning');}finally{planOperation=false;sync();}
    if(added.length&&active)await autoLoadRecords(added);
  };
  const raycaster = new THREE.Raycaster();
  const fields = [...dialog.querySelectorAll('[data-pose]')];
  const categoryLabels={'sleeping-pad':'睡垫','sleeping-bag':'睡袋',tent:'帐篷',tripod:'三脚架','trekking-poles':'登山杖'};
  for (const asset of GEAR_ASSETS) q('equipment').add(new Option(categoryLabels[asset.id]??asset.name, asset.id));
  for (const anchor of mountAnchors) q('anchor').add(new Option(`${anchor.name} · 演示点`, anchor.id));
  q('dimension-summary').textContent = backpackProfile.externalSizeReference
    ?`背包外部尺寸：${Object.values(backpackProfile.externalSizeReference.sizeM).map(v=>v.toFixed(3)).join(' × ')} m（宽×高×深）。官方外部尺寸已核对；外观为程序示意，非厂家模型，内仓/挂点未官方核验。工作坐标框架为米、缩放为1。`
    :`背包外观参考外包尺寸：${backpackFrame.userData.exteriorSizeM?.map(value => value.toFixed(3)).join(' × ') ?? '暂无数据'} m；高度为演示参考 ${backpackFrame.userData.targetExteriorSizeM?.[1]?.toFixed(3) ?? '未知'} m，非实测。模型源单位只在外观子节点换算一次，工作坐标框架为米、缩放为 1。`;
  const sizes = GEAR_ASSETS.filter(asset => ['sleeping-bag', 'sleeping-pad'].includes(asset.id)).map(asset => `${asset.name}参考 ${Object.values(asset.packedSizeM).join(' × ')} m`).join('；');
  const chamberSize = backpackProfile.interior.regions[0].sizeM;
  q('packed-dimension-note').textContent = `仅使用收纳状态尺寸。${sizes}，均为明确的开发假设，不是官方参数或实物压缩率，也不保证装得下。有效轮廓外包尺寸 ${Object.values(chamberSize).join(' × ')} m（约 ${(compileInteriorProfile(backpackProfile.interior.regions[0].profile).volumeM3*1000).toFixed(3)} L）采用随高度变化的斜切凸截面，按截面积精确积分；不是按外包盒体积计算，仅表示演示区域，不是整个背包标称容量。背包采用官方外部尺寸的简化示意，内仓和挂点仍为演示。当前全部装备为程序几何体，无真实装备 GLB。`;
  function pose(target = item) { return localPose(target); }
  function applyPlacement(record, next) { playback?.invalidate();effects?.settle(record);applyLocalPose(record, next, backpackFrame); }
  function bindTransform() {
    transform?.detach();
    if (item && editing && item.placementType !== 'external') transform?.attach(item.group);
  }
  function worldPose(record) {
    record.group.updateWorldMatrix(true, false);
    // Preserve original world Euler values (including 225 degrees) for scene-root gear.
    if (record.group.parent?.matrixWorld.equals(new THREE.Matrix4())) {
      return { ...pose(record), scale: { x: record.group.scale.x, y: record.group.scale.y, z: record.group.scale.z } };
    }
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    record.group.matrixWorld.decompose(position, rotation, scale);
    const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
    const plain = v => ({ x: v.x, y: v.y, z: v.z });
    return { positionM: plain(position), rotationRad: plain(euler), scale: plain(scale) };
  }
  function getInstances() {
    return [...instances.values()].map(record => ({
      ...instanceBinding(record.asset, record.instanceId),
      parameterFingerprint:assetFingerprint(record.asset),
      draftTransform: pose(record), committedTransform: record.committed ? structuredClone(record.committed) : null,
      ...pose(record), ...worldPose(record), frameId: 'world', coordinateFrame: 'world', unit: 'm', rotationUnit: 'rad', rotationOrder: 'XYZ',
      status: record.editing ? 'draft' : record.committed ? 'placed' : 'unconfirmed',
      userAdjusted:!!record.userAdjusted,placementOwner:record.placementOwner??'manual',
      validation: record.validation ? structuredClone(record.validation) : null,
      proxy: record.collisionProxy ? { shape: record.asset.collisionShape, axis: record.asset.collisionAxis,
        sizeM: { ...record.asset.packedSizeM }, dataLevel: record.asset.dataLevel } : null,
    }));
  }
  function sync(message, preserveFields = false) {
    if (!preserveFields) inputError = '';
    if (message) q('status').textContent = message;
    for (const record of instances.values()) {
      record.validation = evaluatePlacement(record, instances.values(), packingSpace.boundsObject);
      record.mountGuide?.update();
      record.collisionProxy?.material.color.set(record.validation.valid ? 0x397d3b : 0xb03932);
      if (record.collisionProxy) record.collisionProxy.visible = q('show-proxies').checked;
    }
    const check = item?.validation;
    effects?.select(item,check?.valid??true);
    const feedback = q('collision');
    feedback.dataset.state = inputError ? 'invalid' : !check ? 'none' : check.valid ? 'valid' : 'invalid';
    const problems = [];
    if (check?.outOfBounds) problems.push('超出背包空间');
    if (check?.overlapInstanceIds.length) problems.push('与其他装备重叠');
    const anchorErrors = ['invalid-anchor', 'detached-anchor', 'outside-anchor-region','incompatible-mount-shape','missing-mount-support','missing-mount-dimensions'];
    if (check?.errorCodes.some(code => anchorErrors.includes(code))) problems.push('外挂位置无效或超出固定区域，请重新选择外挂点');
    const mountErrors=['anchor-capacity','attachment-resource-conflict','mount-overweight','missing-mount-load-data','backpack-collision'];
    if(check?.errorCodes.includes('backpack-collision'))problems.push('与背包外形保护区冲突，请更换挂点');
    if(check?.errorCodes.includes('anchor-capacity'))problems.push('外挂位置已达到数量上限');
    if(check?.errorCodes.includes('attachment-resource-conflict'))problems.push('固定绑带已被其他装备占用');
    if(check?.errorCodes.includes('mount-overweight'))problems.push('超过挂点配置载荷');
    if(check?.errorCodes.includes('missing-mount-load-data'))problems.push('重量或挂点载荷资料缺失，尚不能核验适配');
    const shapeErrors = ['invalid-physical-scale', 'invalid-proxy-transform'];
    if (check?.errorCodes.some(code => shapeErrors.includes(code))) problems.push('装备尺寸变换异常，请取消或重置；不能缩放装备绕过空间限制');
    if (check?.errorCodes.some(code => !['out-of-bounds', 'overlap', ...anchorErrors, ...shapeErrors,...mountErrors].includes(code))) problems.push('暂时无法检查，请重置或重新添加装备');
    const reserved = check?.overlapInstanceIds.some(id => instances.get(id)?.editing);
    feedback.textContent = inputError ? '请补全有效数字，或取消本次调整。' : !check ? '选择装备开始装包' : check.valid
      ? editing ? '可以放置' : item.committed ? '已确认放置' : '选择装备开始装包'
      : `${problems.join('；')}。可继续调整。${reserved ? '对方上次确认位置仍保留，请先确认或取消对方修改。' : ''}`;
    q('selection-name').textContent = item ? `${item.asset.name} · ${item.instanceId.replace('gear-', '')}号${item.placementType === 'external' ? ` · ${anchorById(item.anchorId,mountProfile)?.name ?? '未绑定'}外挂` : ''}` : '你的装包场景';
    q('debug-collision').textContent = JSON.stringify({ selectedInstanceId: item?.instanceId ?? null, validation: check ?? null });
    const drafts = item ? findDraftOverlaps(item, instances.values()) : [];
    q('draft-note').hidden = !drafts.length;
    q('draft-note').textContent = drafts.length
      ? `草稿重叠提醒：另有 ${drafts.length} 件尚未确认的装备与当前位置重叠；暂不占位，不影响本次确认。`
      : '';
    const weights = summarizeWeights(instances.values());
    const space = summarizeSpace(instances.values(), packingSpace.boundsObject);
    const kg = value => value === null ? '暂无官方数据' : `${value.toFixed(3)} kg`;
    q('count').textContent = `${weights.instanceCount} 件`;
    q('placement-counts').textContent=`内部 ${space.placedCount} 件 · 外挂 ${space.externalCount} 件 · 待放置 ${space.pendingCount} 件`;
    q('space-rate').textContent = space.valid ? `${(space.ratio * 100).toFixed(1)}%` : '暂无数据';
    q('known-weight').textContent = kg(weights.knownEquipmentKg);
    q('unknown-count').textContent = `${weights.unknownCount} 件`;
    q('backpack-weight').textContent = kg(weights.backpackKg);
    const loadProfile=loadReferenceFor(officialCollection?.candidates.find(c=>c.candidateId===q('load-reference').value));
    const load=weightProgress(weights,loadProfile),progress=q('load-progress');
    const referenceCandidate=officialCollection?.candidates.find(c=>c.candidateId===q('load-reference').value);
    q('load-model').textContent=loadProfile?[`${referenceCandidate.identity.brand} ${referenceCandidate.identity.model}`,referenceCandidate.identity.editionCode,referenceCandidate.identity.size].filter(Boolean).join(' · '):'当前为匿名演示背包，尚无官方负重范围。';
    progress.dataset.state=load.status;progress.dataset.partial=String(load.partial);
    q('load-value').textContent=load.kg===null?'暂无官方重量数据':`${load.partial?'已知至少 ':'已核验装备 '}${load.kg.toFixed(3)} kg${load.percent===null?'':` / 参考上限 ${loadProfile.maxKg} kg · ${load.percent.toFixed(1)}%`}`;
    q('load-range').textContent=loadProfile?`厂商标称负重范围 ${loadProfile.minKg}–${loadProfile.maxKg} kg · 核验 ${loadProfile.verifiedAt}`:'当前背包暂无已核验负重范围';
    q('load-status').textContent=load.message;q('load-fill').style.width=`${load.fillPercent}%`;
    for(const id of ['load-band','load-marker'])q(id).hidden=load.minPercent===null;
    if(load.minPercent!==null){q('load-band').style.left=`${load.minPercent}%`;q('load-band').style.width=`${100-load.minPercent}%`;q('load-marker').style.left=`${load.minPercent}%`;}
    for(const key of ['aria-valuemin','aria-valuemax','aria-valuenow'])progress.removeAttribute(key);
    if(load.percent!==null){progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax',String(loadProfile.maxKg));progress.setAttribute('aria-valuenow',String(Math.min(load.kg,loadProfile.maxKg)));}
    progress.setAttribute('aria-valuetext',q('load-value').textContent+'；'+load.message);
    q('load-source').hidden=!loadProfile;if(loadProfile){q('load-source').href=loadProfile.sourceUrl;q('load-source').title=loadProfile.location;}else q('load-source').removeAttribute('href');
    q('weight-completeness').textContent = weights.unknownCount
      ? `${weights.unknownCount} 件已放置装备尚未核验重量，当前总重量不完整。`
      : weights.backpackKg === null ? '背包自重暂无官方数据，当前总负重不完整。' : '已放置装备与背包自重资料完整；未计水、食物等消耗品。';
    q('weight-summary').textContent = `已确认放置 ${weights.instanceCount} 件；另有 ${weights.pendingCount} 件待放置，未计入统计。已核验装备重量：${kg(weights.knownEquipmentKg)}；${weights.unknownCount} 件暂无官方数据。背包自重：${kg(weights.backpackKg)}（独立统计）。${weights.totalCarryKg === null ? '当前总负重不完整，暂无完整数据。' : `装备与背包合计：${kg(weights.totalCarryKg)}。`}未计水、食物等消耗品。`;
    q('space-summary').textContent = space.valid
      ? `模拟空间占用率（近似）：${(space.ratio * 100).toFixed(1)}%（外形近似 ${space.occupiedLiters.toFixed(3)} / 演示区域 ${space.spaceLiters.toFixed(3)} L；保守OBB盒合计 ${space.collisionBoxLiters.toFixed(3)} L）。仅统计 ${space.placedCount} 件内部已确认位置，${space.externalCount} 件外挂不计内部体积，${space.pendingCount} 件待放置不计；编辑草稿沿用原确认位置。按配置外形近似体积计算，OBB盒用于快速筛选，圆柱再做保守轮廓检测；边界与外挂仍按保守盒保护；旋转不增加自身体积。按分段截面积积分的演示有效区域，非完整内仓、真实容量或装包成功率。`
      : `模拟空间占用率（近似）：暂无数据。${space.error}。非真实容量验证。`;
    const rows = weights.rows.map(row => {
      const line = document.createElement('li');
      line.textContent = `${row.name} × ${row.count}：${kg(row.officialUnitKg)}`;
      return line;
    });
    q('weight-items').replaceChildren(...rows);
    const spec = item?.asset.productSpec;
    q('product-spec').textContent = !item ? '选中装备查看型号资料。' : `${item.asset.name}：品牌 ${spec?.brand ?? '未知'}；型号 ${spec?.model ?? '未知'}；官方重量 ${kg(spec?.dataStatus === 'verified' ? spec.weightKg : null)}；官方收纳尺寸 ${spec?.dataStatus === 'verified' && spec.packedDimensions ? Object.values(spec.packedDimensions).join(' × ') + ' m' : '暂无官方数据'}；来源 URL ${spec?.sourceUrl ?? '暂无'}；核验日期 ${spec?.verifiedAt ?? '暂无'}；数据状态 ${{ verified: '已核验', demo: '演示（不计官方重量）', missing: '暂无官方数据' }[spec?.dataStatus] ?? '暂无官方数据'}。当前碰撞尺寸为${item.asset.dataLevel === 'demo' ? '演示数据' : '配置尺寸'}。${item.asset.proxyNote ?? ''}`;
    dialog.dataset.state = loading || restoring ? 'loading' : !item ? (instances.size ? 'idle' : 'empty') : editing ? 'draft' : 'placed';
    dialog.dataset.selectedInstance = item?.instanceId ?? '';
    dialog.dataset.instanceCount = String(instances.size);
    dialog.dataset.orbitEnabled = String(orbit.enabled);
    q('add').disabled = loading || restoring;
    q('auto-add').disabled=q('add').disabled;
    q('equipment').disabled = loading || restoring;
    q('product').disabled = loading || restoring;
    q('import-checklist').disabled=loading||restoring||planOperation;
    q('back-to-plan').disabled=loading||restoring||planOperation;
    for(const id of ['save-plan','load-plan','load-history','delete-history','refresh-history','history'])q(id).disabled=loading||restoring||planOperation;
    q('close').disabled=planOperation;
    q('auto-pack').disabled=loading||restoring||planOperation||![...instances.values()].some(r=>!r.userAdjusted&&(!r.committed||q('assist').checked&&r.placementOwner==='auto'));
    q('auto-entry').disabled=loading||restoring||planOperation||![...instances.values()].some(r=>!r.userAdjusted&&(!r.committed||r.placementOwner==='auto'));
    q('auto-entry').textContent=[...instances.values()].some(r=>r.committed&&r.placementOwner==='auto')?'再次优化':'自动装包';
    const staleUndo=!!autoUndo&&autoUndo.signature!==autoSignature();
    q('undo-auto').hidden=!autoUndo;
    q('undo-auto').disabled=!autoUndo||staleUndo||planOperation||loading||restoring;
    q('undo-note').hidden=!staleUndo;
    const list = q('instances');
    // Keep option nodes stable while dragging, so keyboard focus and selection do not jump.
    if (list.options.length !== instances.size + 1 || [...instances.keys()].some(id => ![...list.options].some(option => option.value === id))) {
      list.replaceChildren(new Option('选择已添加装备', ''));
      for (const record of instances.values()) list.add(new Option('', record.instanceId));
    }
    for (const option of [...list.options].slice(1)) {
      const record = instances.get(option.value);
      option.textContent = `${record.asset.name} · ${record.instanceId.replace('gear-', '')}号${!record.committed ? '（待放置）' : record.editing ? '（编辑中）' : '（已放置）'}${record.placementType === 'external' ? ' · 外挂' : ''}${record.userAdjusted?' · 保留手动位置':''}`;
    }
    list.value = item?.instanceId ?? '';
    list.disabled = loading || restoring || !instances.size;
    q('select').disabled = !item || loading || restoring;
    for (const id of ['translate', 'rotate', 'confirm', 'cancel', 'reset']) q(id).disabled = !item || !editing;
    q('confirm').disabled ||= !check?.valid || !!inputError || loading || restoring;
    q('remove').disabled = !item || restoring;
    const external = item?.placementType === 'external';
    q('placement-type').value = external ? 'external' : 'internal';
    q('placement-type').disabled = !item || !editing || loading || restoring;
    const candidates=item?compatibleAnchors(item.asset,mountProfile):[];
    q('placement-type').querySelector('[value=external]').disabled = !candidates.some(c=>c.allowed);
    q('anchor-picker').hidden = !external; q('external-note').hidden = !external;
    for(const option of q('anchor').options){
      const candidate=candidates.find(c=>c.anchor.id===option.value),a=candidate?.anchor;
      const reservation=a&&item?attachmentConflicts(item,instances.values(),{anchorId:a.id}):null;
      const occupied=(reservation?.used??0)+(item?.committed?.placementType==='external'&&item.committed.anchorId===a?.id?1:0);
      option.disabled=!candidate?.allowed;
      const type=ATTACHMENT_TYPE_LABELS[a?.type]??a?.type??'未知接口';
      option.textContent=`${a?.name??option.value} · ${type} · ${occupied}/${a?.capacity??0}${candidate?.allowed?'':' · 不适配'}${reservation?.errorCodes.includes('attachment-resource-conflict')?' · 固定带占用':''}`;
    }
    q('anchor').value = item?.anchorId ?? 'top'; q('anchor').disabled = !editing || loading || restoring;
    const mount=check?.attachment;
    q('external-note').textContent=`演示外挂点，非真实扣具或安全承载认证。${mount?.warning??'匹配挂点类型、收纳尺寸和固定方式后方可确认。'}虚线仅示意固定关系，不是实际绑带。每点有数量上限，固定带不可重复占用；不可自由悬浮或旋转。外挂不计内部占用率，仍计数量和已核验重量。`;
    if (external) { q('translate').disabled = true; q('rotate').disabled = true; }
    if (anchorMarkers) anchorMarkers.visible = !!external;
    const displayPose = item ? worldPose(item) : null;
    for (const field of fields) {
      field.disabled = !item || !editing || external;
      if (preserveFields) continue; // Do not destroy partial numeric input or move the caret.
      if (item) {
        const vector = displayPose[field.dataset.pose === 'position' ? 'positionM' : 'rotationRad'];
        field.value = (vector[field.dataset.axis] * (field.dataset.pose === 'rotation' ? 180 / Math.PI : 1)).toFixed(3);
      } else field.value = '';
    }
    alignmentTools?.setDebugVisible(q('show-alignment').checked);
    alignmentTools?.setDemoVisible(!backpack.visible && q('show-space').checked);
    const alignment = alignmentTools?.update();
    q('alignment-readout').hidden = !q('show-alignment').checked;
    if (alignment && q('show-alignment').checked) q('alignment-readout').textContent = JSON.stringify(alignment, null, 2);
    if(planOperation){for(const id of ['add','auto-add','equipment','product','instances','select','translate','rotate','confirm','cancel','reset','remove','placement-type','anchor','save-plan','load-plan','auto-pack','auto-entry','undo-auto'])q(id).disabled=true;for(const f of fields)f.disabled=true;}
    if(playback)playbackState(playback.status);
    updatePending();
    invalidate();
    backpackFrame.updateWorldMatrix(true, false);
    lastFrameMatrix = backpackFrame.matrixWorld.clone();
    // Plain metric snapshots for future collision consumers; never contain Three.js resources.
    dialog.dispatchEvent(new CustomEvent('packing-instances-change', { detail: { selectedInstanceId: item?.instanceId ?? null, instances: getInstances(), summary: { weights, space } } }));
  }
  function release() {
    if (transform?.dragging) transform.pointerUp({ button: 0 });
    orbit.enabled = true;
    sync();
  }
  function select(id = item?.instanceId) {
    if (!active || loading || restoring) return;
    const next = instances.get(id);
    if (!next) return;
    playback?.skip();
    effects?.settle();
    release(); transform.detach();
    item = next;
    if (!item.editing) {item.editBaseline = pose(item);item.editOwnership={userAdjusted:!!item.userAdjusted,placementOwner:item.placementOwner};}
    item.editing = true; editing = true;
    bindTransform();
    sync(`${item.asset.name}（${item.instanceId}）已选中。仅编辑此实例；切换选择会保留各自草稿。`);
    if (window.matchMedia('(max-width: 1000px)').matches) q('scene-panel').scrollIntoView({ block: 'start' });
  }
  function removeInstance() {
    playback?.invalidate();
    release();
    transform?.detach();
    if(item)effects?.remove(item);
    if (item) instances.delete(item.instanceId);
    item?.dispose();
    item = null; editing = false;
  }
  async function add(equipmentId = q('equipment').value, saved = null) {
    if (loading || !active || (restoring && !saved)) return;
    playback?.invalidate();
    if(instances.size>=100){sync('场景最多100件装备，请先移除一些实例。');return;}
    const ticket = generation;
    let asset = GEAR_ASSETS.find(asset => asset.id === equipmentId);
    if (!asset) { sync('未找到装备配置，请重新选择。'); return; }
    if (!saved) setBackpackView('transparent');
    loading = true; sync(`正在添加${asset.name}…`);
    if(!saved&&!planOperation)loadFeedback(`正在添加${asset.name}…`);
    let result,record;
    try {
      await officialReady;
      const variantId=saved?.variantId??(q('equipment').value===equipmentId?q('product').value:'');
      if(variantId&&variantId!==asset.variantId){
        asset=officialAsset(asset,officialCollection?.candidates.find(c=>c.candidateId===variantId),officialCollection);
      }
      result = await loadGear(asset);
      if (!active || ticket !== generation) { result.dispose(); return; }
      const initial = saved?.committed ?? { positionM: { ...START.positionM, z: (instances.size % 3) * 0.13, y: -Math.floor(instances.size / 3) * 0.16 }, rotationRad: { ...START.rotationRad } };
      const id = saved?.instanceId ?? `gear-${nextInstance++}`;
      result.setPose(initial.positionM, initial.rotationRad);
      record = { ...result, ...instanceBinding(asset, id), initialPose: saved?.initialPose ?? structuredClone(initial),
        placementType: 'internal', anchorId: null, attachmentFrame: backpackFrame,attachmentProfile:mountProfile, internalParent: backpackFrame,
        committed: saved?.committed ?? null, editing: false, editBaseline: null,
        userAdjusted:saved?(saved.userAdjusted??true):false,placementOwner:saved?.placementOwner??'manual' };
      protectPhysicalShape(record);
      if(asset.mounting?.options?.length){
        record.mountGuide=createMountGuide(record,mountProfile);const dispose=record.dispose;
        record.dispose=()=>{record.mountGuide.dispose();dispose();};
      }
      record.group.name = `workbench-${asset.id}`;
      effects?.attach(record);
      {const dispose=record.dispose;record.dispose=()=>{playback?.invalidate();effects?.forget(record);dispose();};}
      Object.assign(record.group.userData, instanceBinding(asset, id));
      if (record.collisionProxy) record.collisionProxy.visible = true;
      instances.set(id, record); backpackFrame.add(record.group);
      applyPlacement(record, initial);
      loading = false;
      if (saved) {
        const check = evaluatePlacement(record, instances.values(), packingSpace.boundsObject);
        if (!check.valid) record.committed = null;
        item = record; editing = false;
        sync(check.valid ? '已恢复已确认装备，并重新检查空间。' : '恢复的装备尚未通过空间检查，请选中后调整并重新确认。');
      }
      else {select(id);effects?.appear(record);invalidate();if(!planOperation)loadFeedback(`已添加${asset.name}，可调整位置。`);}
      return record;
    } catch (error) {
      if(record){instances.delete(record.instanceId);record.dispose();if(item===record){item=null;editing=false;transform?.detach();}}
      else result?.dispose();
      if (active && ticket === generation) sync('装备添加失败：' + error.message + '。已有装备保持不变，可重试。');
      if(active&&ticket===generation&&!saved)loadFeedback('添加失败，请重试；原有装备保持不变。','error');
    } finally {
      if (ticket === generation) { loading = false; sync();if(!saved&&!planOperation&&q('assist').checked&&record&&instances.has(record.instanceId)){assistScope?.add(record.instanceId);scheduleAssist();} }
    }
  }
  q('save-plan').onclick=()=>{
    playback?.skip();
    try{
      if([...instances.values()].some(r=>r.committed&&!evaluatePlacement(r,instances.values(),packingSpace.boundsObject,undefined,r.committed).valid))throw Error('存在非法已确认姿态，不能保存');
      const plan=makePlan(q('plan-name').value,getInstances(),planContext);
      if(localStorage.getItem(PLAN_KEY)&&!window.confirm('将更新最近方案，并新增一条历史记录；旧历史仍保留。是否保存？'))return;
      savePlanHistory(localStorage,plan,planContext);refreshHistory();q('plan-message').textContent=`已保存“${plan.name}”：${plan.instances.length}件已确认装备，已加入历史；保留手动位置保护。待放置和未确认的姿态修改不保存。`;
    }catch(e){q('plan-message').textContent='保存失败：'+e.message+'。原存档未主动删除。';}
  };
  const autoSignature=()=>JSON.stringify(getInstances().map(r=>[r.instanceId,r.variantId,r.draftTransform,r.committedTransform,r.userAdjusted,r.placementOwner]));
  q('stop-auto').onclick=()=>autoController?.abort();
  q('auto-entry').onclick=()=>{
    if(loading||restoring||planOperation)return;
    q('assist').checked=true;assistScope=null;
    setBackpackView('transparent');return runAutoPacking();
  };
  q('undo-auto').onclick=()=>{
    if(!autoUndo||planOperation)return;
    if(autoUndo.signature!==autoSignature()){autoUndo=null;q('auto-message').textContent='场景已手动调整，旧撤销已失效，保留当前布局。';sync();return;}
    clearTimeout(assistTimer);playback?.invalidate();effects?.settle();
    autoUndo.undo();autoUndo=null;editing=!!item?.editing;bindTransform();q('auto-message').textContent='已恢复自动摆放前的场景。';
    q('auto-result').hidden=true;loadFeedback('已撤销本次自动布局，装备恢复到装包前状态。');sync();
  };
  async function runAutoPacking(instanceIds=null){
    if(planOperation||loading||restoring)return;
    clearTimeout(assistTimer);
    const reasonsBefore=new Map(pendingReasons);
    const undoBefore=autoUndo,resultBefore={hidden:q('auto-result').hidden,text:q('auto-result').textContent};
    let previewReady=true;
    playback?.invalidate();effects?.settle();effects?.select(null);
    release();transform.detach();planOperation=true;autoUndo=null;autoController=new AbortController();q('stop-auto').hidden=false;sync();
    loadFeedback('正在装载所选装备…');q('auto-result').hidden=true;
    try{
      try{playback?.stage([...instances.values()].filter(r=>!r.userAdjusted&&(q('assist').checked?(!r.committed||r.placementOwner==='auto'):!r.committed)&&(!instanceIds||instanceIds.includes(r.instanceId))));}catch{previewReady=false;playback?.invalidate();}
      const solver=q('assist').checked?guidedAutoPack:autoPack;
      const result=await solver(instances.values(),packingSpace.boundsObject,{instanceIds,signal:autoController.signal,onProgress:p=>q('auto-message').textContent=`${p.pass?`方案${p.pass}/${p.passes} · `:''}计算中 ${p.done}/${p.total}，已检查${p.checks}个候选位置；可取消。`});
      autoUndo={undo:()=>{result.undo();pendingReasons.clear();for(const [id,reason]of reasonsBefore)pendingReasons.set(id,reason);},signature:autoSignature()};
      pendingReasons.clear();for(const entry of result.unplaced)pendingReasons.set(entry.instanceId,entry.reason);
      try{
        if(playback?.prepare(result.placed)){
          q('auto-message').textContent='布局已计算，正在准备流畅播放；仍可取消。';
          if(renderer.compileAsync)await renderer.compileAsync(scene,camera);
          // Let the existing render loop upload buffers before the animation clock starts.
          invalidate();
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }
      }catch{previewReady=false;playback?.invalidate();}
      if(autoController.signal.aborted){result.undo();autoUndo=null;throw Error('自动装包已取消，恢复原场景');}
      try{playback?.play(result.placed);}catch{previewReady=false;playback?.invalidate();}
      const placed=result.placed.map(id=>instances.get(id));
      q('auto-result').textContent=`最近自动装包参与 ${placed.length+result.unplaced.length} 件：内装 ${placed.filter(r=>r.placementType!=='external').length} 件、外挂 ${placed.filter(r=>r.placementType==='external').length} 件、待调整 ${result.unplaced.length} 件；其余装备保留原位。`;
      q('auto-result').hidden=false;
      q('auto-message').textContent=`已放置${result.placed.length}件，${result.unplaced.length}件待调整。${result.unplaced.map(r=>r.name+'：'+r.reason).join('；')} 手动确认位置保持；可选中装备微调或撤销。有限搜索不保证最优/全局有解，不代表真实容量。`;
      if(q('assist').checked)q('auto-message').textContent+=` 按底部睡眠类、常用物品靠上等偏好尝试3种顺序；手动调整保持不变。体积不变，仅改善布局；不保证最大容量。`;
      if(!previewReady&&result.placed.length)q('auto-message').textContent+=' 动画暂不可用，已直接显示最终布局。';
      loadFeedback(result.unplaced.length?`${result.unplaced.length}件暂未装入，可继续调整。`:result.placed.length?`${result.placed.length}件装备已装载。`:'已保留现有位置。',result.unplaced.length?'warning':'success');
      return result;
    }catch(e){
      playback?.invalidate();
      autoUndo=undoBefore?.signature===autoSignature()?undoBefore:null;
      pendingReasons.clear();for(const [id,reason]of reasonsBefore)pendingReasons.set(id,reason);
      q('auto-result').hidden=resultBefore.hidden;q('auto-result').textContent=resultBefore.text;
      q('auto-message').textContent=e.message+'；已保留或恢复原场景。';loadFeedback('装载未完成，已保留或恢复原布局；可重试或手动调整。','warning');
    }
    finally{planOperation=false;autoController=null;q('stop-auto').hidden=true;editing=!!item?.editing;bindTransform();sync();}
  };
  q('auto-pack').onclick=()=>{setBackpackView('transparent');return runAutoPacking();};
  async function loadSavedPlan(historyId=null){
    if(loading||restoring||planOperation)return;
    clearTimeout(assistTimer);
    playback?.skip();
    let backups=[],plan;const selectedBefore=item?.instanceId??null;planOperation=true;sync();
    try{
      await officialReady;plan=historyId===null?readPlan(localStorage,planContext):historyPlan(localStorage,historyId,planContext);
      // Identity/revision check before touching the current scene.
      for(const row of plan.instances){const base=GEAR_ASSETS.find(a=>a.id===row.equipmentId),asset=row.variantId===base.variantId?base:
        officialAsset(base,officialCollection?.candidates.find(c=>c.candidateId===row.variantId),officialCollection);
        if(asset.dataRevision!==row.dataRevision||assetFingerprint(asset)!==row.parameterFingerprint)throw Error('装备参数版本已变化，请重新检查方案');}
      if(instances.size&&!window.confirm('读取方案将替换当前场景，是否继续？'))return;
      autoUndo=null;pendingReasons.clear();q('auto-result').hidden=true;
      backups=[...instances.values()].map(r=>({...instanceBinding(r.asset,r.instanceId),committed:pose(r),initialPose:r.initialPose,oldCommitted:r.committed,wasEditing:r.editing,editBaseline:r.editBaseline,internalDraft:r.internalDraft,userAdjusted:!!r.userAdjusted,placementOwner:r.placementOwner,editOwnership:r.editOwnership}));
      release();transform.detach();for(const r of instances.values())r.dispose();instances.clear();item=null;editing=false;
      restoring=true;sync();
      for(const row of plan.instances){await add(row.equipmentId,row);if(!instances.get(row.instanceId)?.committed)throw Error('方案装备重叠、越界或挂点不合法');}
      nextInstance=Math.max(nextInstance,...plan.instances.map(r=>Number(r.instanceId.slice(5))+1));
      assistScope=new Set([...instances.values()].filter(r=>r.placementOwner==='auto'&&!r.userAdjusted).map(r=>r.instanceId));
      q('plan-name').value=plan.name;q('plan-message').textContent=`已读取“${plan.name}”，全部装备重新通过空间检查。`;
      q('trip-context').hidden=true; // Stored layouts do not yet carry a trip association.
    }catch(e){
      if(restoring){for(const r of instances.values())r.dispose();instances.clear();item=null;editing=false;
        for(const row of backups){await add(row.equipmentId,row);const r=instances.get(row.instanceId);if(r){r.committed=row.oldCommitted;r.editing=row.wasEditing;r.editBaseline=row.editBaseline;r.internalDraft=row.internalDraft;r.editOwnership=row.editOwnership;}}
        item=instances.get(selectedBefore)??null;editing=!!item?.editing;bindTransform();}
      q('plan-message').textContent='读取失败：'+e.message+'。未修改存档，恢复原场景。';
    }finally{restoring=false;planOperation=false;sync();}
  }
  q('load-plan').onclick=()=>loadSavedPlan();
  let historyRecords=[];
  q('history').onchange=()=>{const record=historyRecords.find(r=>r.id===q('history').value);q('history-detail').textContent=record?`${record.plan.name} · 保存于 ${record.id==='legacy-plan'&&record.savedAt===new Date(0).toISOString()?'时间未记录':new Date(record.savedAt).toLocaleString('zh-CN')} · ${record.plan.instances.length} 件已确认装备`:'选择记录后可查看完整名称与保存时间。';};
  function refreshHistory(){
    try{
      const previous=q('history').value,records=readHistory(localStorage);q('history').replaceChildren(new Option('选择历史装包方案',''));
      for(const record of records)q('history').add(new Option(`${record.plan.name} · ${new Date(record.savedAt).toLocaleString('zh-CN')} · ${record.plan.instances.length}件${record.id==='legacy-plan'?' · 原有方案':''}`,record.id));
      if(records.some(r=>r.id===previous))q('history').value=previous;
      historyRecords=records;q('history').onchange();
      q('history-message').textContent=records.length?`已保存 ${records.length}/${HISTORY_LIMIT} 条；同名也分别保存。读取前会重新检查。`:'还没有历史记录，确认装备后点击“保存到本机”。';
    }catch(e){historyRecords=[];q('history-detail').textContent='';q('history').replaceChildren(new Option('历史暂不可用',''));q('history-message').textContent='历史读取失败：'+e.message+'；未清理原记录。';}
  }
  q('refresh-history').onclick=refreshHistory;
  q('plans').addEventListener('toggle',()=>{if(q('plans').open)refreshHistory();});
  q('load-history').onclick=()=>{if(!q('history').value){q('history-message').textContent='请先选择一条历史记录。';return;}return loadSavedPlan(q('history').value);};
  q('delete-history').onclick=()=>{
    if(planOperation||loading||restoring)return;const id=q('history').value;if(!id){q('history-message').textContent='请先选择一条历史记录。';return;}
    if(!window.confirm('删除选中的历史记录？当前场景、最近方案和其他历史不受影响。'))return;
    try{removeHistory(localStorage,id);refreshHistory();q('history-message').textContent='已删除选中历史；当前场景与最近方案保持不变。';}catch(e){q('history-message').textContent='删除失败：'+e.message;}
  };
  function cancel() {
    if (!editing) return;
    clearTimeout(assistTimer);
    release();
    const hasCommitted = !!item.committed;
    if (hasCommitted) {
      const from=effects?.capture(item);
      applyPlacement(item, item.editBaseline);
      if(item.editOwnership)Object.assign(item,item.editOwnership);
      item.editing = false; editing = false; transform.detach();
      if(from)effects?.returnTo(item,from);
    } else removeInstance();
    sync(hasCommitted ? '已取消当前实例修改，恢复编辑前的姿态；其他装备不变。' : '已撤销当前未确认的新实例；其他装备不变。');
    loadFeedback(hasCommitted?'已取消修改。':'已撤销添加。');
  }
  function pointerDown(event) {
    if (!active || loading || restoring || planOperation || !instances.size || event.button !== 0) return;
    playback?.skip();
    effects?.settle();
    const rect = canvas.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) / rect.width * 2 - 1,
      y: -(event.clientY - rect.top) / rect.height * 2 + 1, button: 0 };
    transform.pointerHover(point);
    if (transform.axis) {
      // Capture phase precedes OrbitControls' pointerdown listener.
      orbit.enabled = false; sync(); return;
    }
    raycaster.setFromCamera(point, camera);
    const visuals = [...instances.values()].map(record => record.visual);
    const hit = raycaster.intersectObjects(visuals, true)[0];
    if (hit) {
      let node = hit.object;
      while (node && !node.userData.instanceId) node = node.parent;
      if (node) select(node.userData.instanceId);
    }
  }
  function finishPointer() {
    // Native listboxes commit selection after pointerup. An unrelated window
    // pointerup must not sync the previous item back into the pending selection.
    // Only a gizmo gesture needs this outside-canvas/blur recovery path.
    if (active && (transform?.dragging || !orbit.enabled)) release();
  }
  function mode(value) {
    if (!editing || item?.placementType === 'external') return;
    release(); transform.setMode(value);
    q('translate').setAttribute('aria-pressed', String(value === 'translate'));
    q('rotate').setAttribute('aria-pressed', String(value === 'rotate'));
    sync(value === 'translate' ? '平移模式：拖动 X / Y / Z 箭头；单位为米。' : '旋转模式：拖动彩色圆环；输入框使用角度。');
  }
  q('add').onclick = () => {
    if(loading||restoring||planOperation)return;
    clearTimeout(assistTimer);q('assist').checked=false;
    return add();
  };
  async function autoLoadRecords(records) {
    const current=records.filter(record=>active&&instances.has(record.instanceId));
    if(!current.length)return;
    q('assist').checked=true;
    if(!assistScope)assistScope=new Set([...instances.values()].filter(r=>r.placementOwner==='auto').map(r=>r.instanceId));
    assistScope=new Set([...assistScope].filter(id=>instances.get(id)?.placementOwner==='auto'));
    for(const record of current)assistScope.add(record.instanceId);
    const result=await runAutoPacking([...assistScope].filter(id=>instances.has(id)));
    if(result&&current.length===1){const record=current[0];loadFeedback(record.committed?`${record.asset.name}已装载。`:`${record.asset.name}暂未装入，已留在待放区。`,record.committed?'success':'warning');}
    return result;
  }
  q('auto-add').onclick = async () => {
    if(!active||loading||restoring||planOperation||['playing','paused'].includes(playback?.status.state))return;
    clearTimeout(assistTimer);
    const record=await add();
    if(!record||!active||!instances.has(record.instanceId))return;
    await autoLoadRecords([record]);
  };
  q('show-proxies').onchange = () => sync();
  q('show-space').onchange = () => { packingSpace.setVisible(q('show-space').checked); sync(); };
  q('show-alignment').onchange = () => sync();
  q('more').addEventListener('click', event => { if (event.target.closest('button')) q('more').open = false; });
  q('select').onclick = () => select();
  q('instances').onchange = () => {
    if (q('instances').value) select(q('instances').value);
    else { release(); transform.detach(); item = null; editing = false; sync('未选中装备，各实例草稿仍保留。'); }
  };
  // A visible list must also reopen editing when its already-selected row is clicked.
  q('instances').onclick = () => { if (q('instances').value && !editing) select(q('instances').value); };
  q('instances').onkeydown = event => { if (event.key === 'Enter' && q('instances').value && !editing) select(q('instances').value); };
  q('translate').onclick = () => mode('translate');
  q('rotate').onclick = () => mode('rotate');
  function changeAttachment(anchorId) {
    if (!item || !editing || !compatibleAnchors(item.asset,mountProfile).some(c=>c.anchor.id===anchorId&&c.allowed)) { sync(); return; }
    release(); applyPlacement(item, anchorPose(anchorId,item.asset,mountProfile)); markUserAdjusted();bindTransform();scheduleAssist();
    sync(`已绑定${anchorById(anchorId,mountProfile).name}演示外挂点，待确认。`);
  }
  q('placement-type').onchange = () => {
    if (!item || !editing) return;
    if (q('placement-type').value === 'external') {
      if (item.placementType !== 'external') item.internalDraft = pose();
      changeAttachment(compatibleAnchors(item.asset,mountProfile).find(c=>c.allowed)?.anchor.id);
    } else {
      release(); applyPlacement(item, item.internalDraft ?? { ...START, placementType: 'internal' }); bindTransform();
      markUserAdjusted();scheduleAssist();
      sync('已切换到内部放置，请调整到合法位置再确认。');
    }
  };
  q('anchor').onchange = () => changeAttachment(q('anchor').value);
  q('confirm').onclick = () => {
    if (!item || !editing) return;
    if (inputError) { sync('请先补全有效的姿态数字，再确认放置。', true); return; }
    release();
    if (!evaluatePlacement(item, instances.values(), packingSpace.boundsObject).valid) {
      sync('当前位置未通过空间检查，不能确认；可以继续编辑或取消。'); return;
    }
    item.committed = pose();markUserAdjusted(); item.editing = false; editing = false; transform.detach();scheduleAssist();
    effects?.settle(item);effects?.confirm(item);
    sync('已确认放置（仅本次页面会话），通过演示空间 AABB + OBB 检查；不代表真实容量验证。');
  };
  q('cancel').onclick = cancel;
  q('remove').onclick = () => {
    if (!item) return;
    release();
    if (item.committed && !window.confirm(`移除已确认的${item.asset.name}（${item.instanceId.replace('gear-', '')}号）？其他装备保持不变。`)) return;
    removeInstance(); sync('已移除当前实例；其他装备保持不变。');
    loadFeedback('已移除装备。');
    scheduleAssist();
  };
  q('reset').onclick = () => {
    if (!item || !editing) return;
    release(); applyPlacement(item, item.placementType === 'external' ? anchorPose(item.anchorId,item.asset,mountProfile) : item.initialPose);
    markUserAdjusted();scheduleAssist();
    bindTransform(); sync('已重置当前实例到自身初始位置或绑定的外挂点；可确认或取消。');
  };
  function setBackpackView(mode) {
    const inside = mode === 'inside';
    backpackView.set(mode);
    q('hide-bag').setAttribute('aria-pressed', String(inside));
    q('show-bag').setAttribute('aria-pressed', String(mode === 'exterior'));
    q('transparent-bag').setAttribute('aria-pressed', String(mode === 'transparent'));
    q('view-hint').textContent = inside ? '外壳已隐藏，可直接点击装备；拖动空白处换个角度。' : mode === 'transparent' ? '背包已透明，可查看装载；点击“背包外观”恢复。' : '切到包内物品，可直接查看和选择装备。';
    q('alignment-note').textContent = backpack.visible ? '有效区域按当前外形采样建立保守截面近似，仍非真实内壁；装备需完整放入此区域。' : '当前查看与碰撞一致的分段轮廓；隐藏的只是外观，装备未隐藏。轮廓是保守演示近似，不是真实内壁。';
    sync();
  }
  q('hide-bag').onclick = () => setBackpackView('inside');
  q('show-bag').onclick = () => setBackpackView('exterior');
  q('transparent-bag').onclick = () => setBackpackView('transparent');
  function applyFields(field, live = false) {
    playback?.invalidate();
    effects?.settle(item);
    if (!item || !editing || item.placementType === 'external') return;
    try {
      if (!fields.every(input => input.value.trim() && Number.isFinite(Number(input.value)))) throw new Error('请输入有限数字');
      const next = live ? worldPose(item) : { positionM: {}, rotationRad: {} };
      // Live typing updates only its own component, preserving other full-precision angles.
      for (const input of live ? [field] : fields) next[input.dataset.pose === 'position' ? 'positionM' : 'rotationRad'][input.dataset.axis] =
        Number(input.value) * (input.dataset.pose === 'rotation' ? Math.PI / 180 : 1);
      setWorldPose(item, next.positionM, next.rotationRad);
      markUserAdjusted();if(!live)scheduleAssist();
      inputError = '';
      sync('姿态已更新，等待确认。', live);
    } catch (error) {
      inputError = error.message;
      sync('姿态未更改：' + error.message, live);
    }
  }
  for (const field of fields) {
    field.oninput = () => applyFields(field, true);
    field.onchange = () => applyFields(field);
  }
  function close(preserveTripDrafts=false) {
    if(planOperation)return;
    if (!active) return;
    // Only confirmed snapshots survive leaving; no instance shares another's edit history.
    const keepDrafts=preserveTripDrafts===true;
    tripSelectedId=keepDrafts?item?.instanceId:null;
    if (!restoring) savedInstances = [...instances.values()].filter(record => keepDrafts||record.committed).map(record => ({
      ...instanceBinding(record.asset, record.instanceId),
      userAdjusted:!!record.userAdjusted,placementOwner:record.placementOwner,
      committed: structuredClone(keepDrafts?pose(record):record.committed), initialPose: structuredClone(record.initialPose),
      ...(keepDrafts?{tripDraft:true,oldCommitted:structuredClone(record.committed),wasEditing:record.editing,editBaseline:structuredClone(record.editBaseline),editOwnership:record.editOwnership}:{}),
    }));
    active = false;loadFeedback('');q('auto-result').hidden=true;pendingReasons.clear();pendingSignature='';resumeAfterVisibility=false;clearTimeout(assistTimer); generation++; loading = false; restoring = false;autoUndo=null;
    playback?.dispose();playback=null;backpackView.dispose();document.removeEventListener('visibilitychange',visibilityChange);
    motionPreference.removeEventListener('change',motionChange);
    effects?.dispose();effects=null;
    release(); transform?.detach();
    for (const record of instances.values()) record.dispose();
    instances.clear(); item = null; editing = false;
    sync();
    canvas.removeEventListener('pointerdown', pointerDown, true);
    window.removeEventListener('pointerup', finishPointer);
    window.removeEventListener('pointercancel', finishPointer);
    window.removeEventListener('blur', finishPointer);
    alignmentTools?.dispose(); alignmentTools = null;
    helper?.removeFromParent(); transform?.dispose();
    if (anchorMarkers) {
      anchorMarkers.removeFromParent();
      anchorMarkers.children[0].geometry.dispose(); anchorMarkers.children[0].material.dispose();
      anchorMarkers = null;
    }
    transform = null; helper = null;
    canvas.style.touchAction = 'none';
    anchor.after(shell);
    if (dialog.open) dialog.close();
    leaveView();
  }
  q('close').onclick = close;
  q('back-to-plan').onclick=()=>{if(planOperation||loading||restoring)return;close(true);location.hash='plan';};
  dialog.addEventListener('cancel', event => { event.preventDefault(); if(planOperation)return;if (editing) cancel(); else close(); });
  return {
    getInstances,
    async autoArrange(instanceIds=null){
      await openReady;
      if(!active||loading||restoring||planOperation)throw Error('工作台正在处理操作，请稍后重试');
      q('assist').checked=true;assistScope=instanceIds===null?null:new Set(instanceIds);
      return runAutoPacking(instanceIds);
    },
    async beginTrip(snapshot){
      await openReady;
      if(!active||loading||restoring||planOperation)throw Error('工作台正在处理操作，请稍后重试');
      const kit=plannedKit(snapshot,[...instances.values()]);
      if(instances.size+kit.freshIds.length>100)throw Error('场景装备过多，请先移除不需要的实例');
      planOperation=true;playback?.invalidate();effects?.settle();sync();
      let added=0;
      try{
        q('trip-context').hidden=false;q('trip-label').textContent=`当前行程：${kit.label}`;
        q('trip-checklist-only').textContent=kit.checklistOnly.length?kit.checklistOnly.map(r=>r.name).join('、')+'。这些项目未自动创建3D模型，需选择具体型号或在清单中核对。':'本次选择均可直接带入；仍需核对实际装备和准备情况。';
        for(const id of kit.freshIds){const before=instances.size;q('equipment').value=id;updateProductOptions();q('product').value='';await add(id);if(instances.size>before)added++;}
        const failed=kit.freshIds.length-added;
        q('trip-message').textContent=`已带入${added}类待放装备，已有${kit.existingIds.length}类保留。${failed?`${failed}类添加失败，可重试。`:''}演示型号可更换，未自动勾选准备或确认放置。`;
        return {added,failed:kit.freshIds.length-added,instanceIds:[...instances.values()].filter(r=>kit.equipmentIds.includes(r.equipmentId)).map(r=>r.instanceId)};
      }finally{planOperation=false;sync();}
    },
    async chooseLoadReference(candidateId){await officialReady;
      if(!loadReferenceIds().includes(candidateId))return false;
      q('load-reference').value=candidateId;q('load-reference').onchange();return true;
    },
    async chooseProduct(equipmentId,variantId){await officialReady;const base=GEAR_ASSETS.find(a=>a.id===equipmentId);
      if(!base||!officialCollection||!officialOptions(officialCollection,equipmentId).some(o=>o.id===variantId&&o.available))return false;
      q('equipment').value=equipmentId;updateProductOptions();q('product').value=variantId;q('product').onchange();return true;},
    update() {
      if (!active) return;
      if(playback?.tick())invalidate();
      if(effects?.tick())invalidate();
      backpackFrame.updateWorldMatrix(true, false);
      if (lastFrameMatrix && !backpackFrame.matrixWorld.equals(lastFrameMatrix)) sync('背包变换已同步到内部装备、外挂点和空间检测。');
    },
    open() {
      if (active) return openReady;
      try {
        transform = new TransformControls(camera, canvas);
        transform.setSpace('world'); transform.setSize(0.75);
        helper = transform.getHelper(); scene.add(helper);
        anchorMarkers = new THREE.Group(); anchorMarkers.name = 'external-anchor-markers';
        const geometry = new THREE.SphereGeometry(0.009, 8, 6);
        const material = new THREE.MeshBasicMaterial({ color: 0xc4a45f, depthTest: false });
        for (const anchor of mountAnchors) {
          const marker = new THREE.Mesh(geometry, material); marker.position.set(...anchor.positionM); marker.renderOrder = 13;
          anchorMarkers.add(marker);
        }
        backpackFrame.add(anchorMarkers);
        transform.addEventListener('change', invalidate);
        transform.addEventListener('objectChange', () => {markUserAdjusted();playback?.invalidate();effects?.settle(item);sync('姿态已更改，等待确认。');});
        transform.addEventListener('dragging-changed', event => { orbit.enabled = !event.value;if(!event.value)scheduleAssist(); sync(); });
        enterView();
        alignmentTools = createAlignmentTools(backpack, backpackFrame, packingSpace);
        active = true;
        effects=createPackingEffects(scene,{reduced:q('reduce-motion').checked});
        playback=createAutoPlayback({backpack,fadeBackpack:false,reduced:q('reduce-motion').checked,onState:playbackState,onPlaced:record=>effects?.confirm(record)});
        playbackState(playback.status);document.addEventListener('visibilitychange',visibilityChange);
        motionPreference.addEventListener('change',motionChange);
        document.querySelector('#workbench-canvas-slot').append(shell);
        dialog.showModal();
        backpack.visible = true; packingSpace.setVisible(true);
        q('show-space').checked = true; q('show-proxies').checked = false; q('show-alignment').checked = false;
        q('alignment-note').textContent = '当前尺寸示意主包体留边的分段主仓近似，不是官方内仓；装备需完整放入此区域，外部尺寸与模拟体积不等于真实装载容量。';
        for (const id of ['precision', 'display', 'debug', 'more', 'statistics', 'dimensions']) q(id).open = false;
        q('hide-bag').setAttribute('aria-pressed', 'false'); q('show-bag').setAttribute('aria-pressed', 'true');
        q('transparent-bag').setAttribute('aria-pressed', 'false');
        q('view-hint').textContent = '切到包内物品，可直接查看和选择装备。';
        q('translate').setAttribute('aria-pressed', 'true'); q('rotate').setAttribute('aria-pressed', 'false');
        canvas.addEventListener('pointerdown', pointerDown, true);
        window.addEventListener('pointerup', finishPointer);
        window.addEventListener('pointercancel', finishPointer);
        window.addEventListener('blur', finishPointer);
        sync('工作台已就绪。从装备库选择并添加，可重复添加同款。');
        const ticket = generation;
        const restore = async () => {
          restoring = savedInstances.length > 0;
          try {
            for (const saved of savedInstances) {
              if (!active || ticket !== generation) return;
              await add(saved.equipmentId, saved);
              const record=instances.get(saved.instanceId);
              if(saved.tripDraft&&record){record.committed=structuredClone(saved.oldCommitted);record.editing=saved.wasEditing;record.editBaseline=structuredClone(saved.editBaseline);record.editOwnership=saved.editOwnership;}
            }
          } finally {
            if (ticket === generation) { restoring = false;
              if(tripSelectedId&&instances.has(tripSelectedId)){item=instances.get(tripSelectedId);editing=item.editing;bindTransform();}
              sync(); }
          }
        };
        openReady=restore();
        return openReady;
      } catch (error) {
        active = true; close(); throw error;
      }
    }, close,
  };
}
