import { parseRequest } from "../server/src/shared/validation.mjs";
import {
  libraryAddModelImagePayloadSchema,
  libraryAssetUploadPayloadSchema,
  libraryBulkEntriesPayloadSchema,
  libraryCreateModelPayloadSchema,
  libraryCreateProjectPayloadSchema,
  libraryCreateTagPayloadSchema,
  libraryImportEntriesPayloadSchema,
  libraryTagProjectQuerySchema,
  libraryUpdateActionPayloadSchema,
  libraryUpdateModelPayloadSchema,
  libraryUpdateOutfitPayloadSchema,
  libraryUpdateProjectPayloadSchema,
  libraryUpdateTagPayloadSchema,
} from "../server/src/library/library-route-schemas.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectValid(schema, name, input, verify) {
  const result = parseRequest(schema, input);
  assert(result.ok, `${name}: expected valid, got ${JSON.stringify(result.body)}`);
  verify?.(result.value);
}

function expectInvalid(schema, name, input, expectedPath) {
  const result = parseRequest(schema, input);
  assert(!result.ok, `${name}: expected invalid`);
  assert(result.status === 400, `${name}: expected status 400`);
  assert(result.body?.detail, `${name}: expected detail`);
  if (expectedPath) {
    const paths = (result.body.fields || []).map((field) => field.path);
    assert(paths.includes(expectedPath), `${name}: expected field path ${expectedPath}, got ${paths.join(", ")}`);
  }
}

expectValid(libraryBulkEntriesPayloadSchema, "bulk delete normalizes ids", {
  project_id: " project_a ",
  entry_ids: [" item_1 ", "item_1", "item_2"],
  operation: " delete ",
}, (value) => {
  assert(value.project_id === "project_a", "project_id should trim");
  assert(value.entry_ids.length === 2, "entry_ids should dedupe");
  assert(value.operation === "delete", "operation should trim");
});

expectValid(libraryBulkEntriesPayloadSchema, "bulk add tags normalizes tags", {
  project_id: "project_a",
  entry_ids: ["item_1"],
  operation: "add_tags",
  tags: [" alpha ", "alpha", "very-long-tag-name-that-will-be-truncated"],
}, (value) => {
  assert(value.tags.length === 2, "tags should dedupe");
  assert(value.tags[1].length === 24, "tags should truncate to 24 characters");
});

expectInvalid(libraryBulkEntriesPayloadSchema, "missing project id", {
  project_id: " ",
  entry_ids: ["item_1"],
  operation: "delete",
}, "project_id");

expectInvalid(libraryBulkEntriesPayloadSchema, "empty entries", {
  project_id: "project_a",
  entry_ids: [],
  operation: "delete",
}, "entry_ids");

expectInvalid(libraryBulkEntriesPayloadSchema, "too many entries", {
  project_id: "project_a",
  entry_ids: Array.from({ length: 501 }, (_, index) => `item_${index}`),
  operation: "delete",
}, "entry_ids");

expectInvalid(libraryBulkEntriesPayloadSchema, "unsupported operation", {
  project_id: "project_a",
  entry_ids: ["item_1"],
  operation: "move",
}, "operation");

expectInvalid(libraryBulkEntriesPayloadSchema, "tags required for add", {
  project_id: "project_a",
  entry_ids: ["item_1"],
  operation: "add_tags",
  tags: [],
}, "tags");

expectInvalid(libraryBulkEntriesPayloadSchema, "unknown key rejected", {
  project_id: "project_a",
  entry_ids: ["item_1"],
  operation: "delete",
  extra: true,
}, "");

expectValid(libraryTagProjectQuerySchema, "tag query trims project id", {
  project_id: " project_a ",
}, (value) => {
  assert(value.project_id === "project_a", "tag query project_id should trim");
});

expectInvalid(libraryTagProjectQuerySchema, "tag query requires project id", {
  project_id: " ",
}, "project_id");

expectValid(libraryCreateTagPayloadSchema, "create tag normalizes name and color", {
  name: "  Alpha   Beta That Is Far Too Long  ",
  color: "unknown",
}, (value) => {
  assert(value.name === "Alpha Beta That Is Far T", `tag name should normalize and truncate, got ${value.name}`);
  assert(value.name.length === 24, "tag name should truncate to 24 characters");
  assert(value.color === "default", "unknown tag color should normalize to default");
});

expectInvalid(libraryCreateTagPayloadSchema, "create tag rejects empty name", {
  name: " ",
}, "name");

expectValid(libraryUpdateTagPayloadSchema, "update tag normalizes sort order string", {
  sort_order: "12",
}, (value) => {
  assert(value.sort_order === 12, "sort_order string should normalize to number");
});

expectValid(libraryUpdateTagPayloadSchema, "update tag normalizes unknown color", {
  color: "unknown",
}, (value) => {
  assert(value.color === "default", "unknown update tag color should normalize to default");
});

expectInvalid(libraryUpdateTagPayloadSchema, "update tag rejects unknown key", {
  name: "Alpha",
  extra: true,
}, "");

expectValid(libraryCreateProjectPayloadSchema, "create project accepts missing name", {}, (value) => {
  assert(!Object.hasOwn(value, "name"), "missing project name should stay missing");
});

expectValid(libraryCreateProjectPayloadSchema, "create project preserves name for service validation", {
  name: "   ",
}, (value) => {
  assert(value.name === "   ", "project name whitespace should be preserved for service validation");
});

expectInvalid(libraryCreateProjectPayloadSchema, "create project rejects unknown key", {
  name: "Project",
  sort_order: 1,
}, "");

expectValid(libraryUpdateProjectPayloadSchema, "update project normalizes cover asset and sort order", {
  cover_asset_id: "",
  sort_order: "12",
}, (value) => {
  assert(value.cover_asset_id === null, "empty cover_asset_id should normalize to null");
  assert(value.sort_order === 12, "project sort_order string should normalize to number");
});

expectValid(libraryUpdateProjectPayloadSchema, "update project stringifies cover asset id", {
  cover_asset_id: 123,
}, (value) => {
  assert(value.cover_asset_id === "123", "cover_asset_id should stringify truthy values");
});

expectInvalid(libraryUpdateProjectPayloadSchema, "update project rejects unknown key", {
  name: "Project",
  extra: true,
}, "");

expectValid(libraryAssetUploadPayloadSchema, "asset upload applies filename and mime defaults", {
  data: "not-validated-as-base64",
}, (value) => {
  assert(value.filename === "image", "asset upload filename should default to image");
  assert(value.mime_type === "image/png", "asset upload mime_type should default to image/png");
  assert(value.data === "not-validated-as-base64", "asset upload data should not be decoded in schema");
});

expectValid(libraryAssetUploadPayloadSchema, "asset upload stringifies filename and mime", {
  filename: 123,
  mime_type: null,
  data: "abc",
}, (value) => {
  assert(value.filename === "123", "asset upload filename should stringify");
  assert(value.mime_type === "image/png", "asset upload null mime_type should default");
});

expectInvalid(libraryAssetUploadPayloadSchema, "asset upload requires data", {
  filename: "image.png",
}, "data");

expectInvalid(libraryAssetUploadPayloadSchema, "asset upload rejects empty data", {
  data: "",
}, "data");

expectInvalid(libraryAssetUploadPayloadSchema, "asset upload rejects unknown key", {
  data: "abc",
  thumbnail_data_url: "data:image/png;base64,abc",
}, "");

expectValid(libraryCreateModelPayloadSchema, "create model normalizes gender", {
  name: "Model A",
  gender: "other",
}, (value) => {
  assert(value.name === "Model A", "model name should pass through");
  assert(value.gender === "unknown", "unsupported gender should normalize to unknown");
});

expectInvalid(libraryCreateModelPayloadSchema, "create model rejects unknown key", {
  name: "Model A",
  tags: [],
}, "");

expectValid(libraryUpdateModelPayloadSchema, "update model normalizes tags and cover image", {
  tags: [" alpha ", "alpha", "very-long-tag-name-that-will-be-truncated"],
  cover_image_id: "",
}, (value) => {
  assert(value.tags.length === 2, "model tags should normalize and dedupe");
  assert(value.tags[1].length === 24, "model tags should truncate");
  assert(value.cover_image_id === null, "empty cover_image_id should normalize to null");
});

expectInvalid(libraryUpdateModelPayloadSchema, "update model rejects non-array tags", {
  tags: "alpha",
}, "tags");

expectValid(libraryAddModelImagePayloadSchema, "add model image normalizes fields", {
  asset_id: 123,
  caption: null,
  sort_order: "7",
}, (value) => {
  assert(value.asset_id === "123", "asset_id should stringify");
  assert(value.caption === "", "null caption should normalize to empty string");
  assert(value.sort_order === 7, "sort_order should normalize to number");
});

expectInvalid(libraryAddModelImagePayloadSchema, "add model image requires asset id", {
  asset_id: "",
}, "asset_id");

expectValid(libraryUpdateOutfitPayloadSchema, "update outfit normalizes tags", {
  tags: [" beta ", "beta"],
}, (value) => {
  assert(value.tags.length === 1 && value.tags[0] === "beta", "outfit tags should normalize");
});

expectValid(libraryUpdateActionPayloadSchema, "update action normalizes prompt and tags", {
  prompt: "x".repeat(4005),
  tags: [" gamma ", "gamma"],
}, (value) => {
  assert(value.prompt.length === 4000, "action prompt should truncate to 4000 characters");
  assert(value.tags.length === 1 && value.tags[0] === "gamma", "action tags should normalize");
});

expectInvalid(libraryUpdateActionPayloadSchema, "update action rejects unknown key", {
  prompt: "ok",
  extra: true,
}, "");

expectValid(libraryImportEntriesPayloadSchema, "import entries keeps row payloads passthrough", {
  entries: [{ id: "row_1", unexpected: true }],
}, (value) => {
  assert(value.entries[0].unexpected === true, "import rows should passthrough unknown row fields");
});

expectValid(libraryImportEntriesPayloadSchema, "import entries does not validate row shape", {
  entries: ["not-an-object"],
}, (value) => {
  assert(value.entries[0] === "not-an-object", "import row shape should stay service-owned");
});

expectInvalid(libraryImportEntriesPayloadSchema, "import entries requires rows", {
  entries: [],
}, "entries");

expectInvalid(libraryImportEntriesPayloadSchema, "import entries rejects unknown top-level key", {
  entries: [{}],
  extra: true,
}, "");

console.log("Zod schema validation checks passed.");
