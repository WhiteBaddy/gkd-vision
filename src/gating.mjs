/** 系统界面：即使节点少也不判定为"被门控"。 */
const SYSTEM_PACKAGES = new Set([
  'android',
  'com.android.systemui',
  'com.android.launcher',
  'com.android.launcher3',
  'com.miui.home',
  'com.miui.securitycenter',
  'com.android.settings',
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
]);

/**
 * 判定当前页面是否"只有壳、没有内容"。
 * 经验规则：非系统包且节点数 ≤ 2 → 视为树被门控（微信等应用的典型行为）。
 */
export function diagnoseGating(frame) {
  const nodeCount = frame?.nodes?.length ?? 0;
  const pkg = frame?.appId ?? '';
  if (!pkg) return { gated: false, reason: 'no-frame', nodeCount: 0 };
  if (SYSTEM_PACKAGES.has(pkg)) return { gated: false, reason: 'system-ui', nodeCount, package: pkg };
  if (nodeCount <= 2) return { gated: true, reason: 'tree-hidden', nodeCount, package: pkg };
  return { gated: false, reason: 'ok', nodeCount, package: pkg };
}

export function gatingHint(gating) {
  if (!gating?.gated) return null;
  return {
    message: '当前应用只导出空壳节点，通常是"辅助服务白名单"门控（如微信）。',
    action: 'tools/a11y-compat.sh on',
    note: '兼容模式会额外启用 Select to Speak（静默、无朗读），可用 off 还原。',
  };
}
