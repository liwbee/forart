const LIBTV_MACHINE_ID_MAX_LENGTH = 32;

function normalizeLibtvMachineId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, LIBTV_MACHINE_ID_MAX_LENGTH);
}

function createLibtvWorkspaceName(machineId) {
  const normalized = normalizeLibtvMachineId(machineId);
  return normalized ? `LibtvImage-${normalized}` : 'LibtvImage';
}

module.exports = { LIBTV_MACHINE_ID_MAX_LENGTH, createLibtvWorkspaceName, normalizeLibtvMachineId };
