import type { Pending } from "./journal";
export function uploadChunks(entities: Pending["patch"]["upserts"]) {
  const encoder = new TextEncoder();
  const measured = entities.map((entity) => ({
    entity,
    size: encoder.encode(JSON.stringify(entity)).length + 1,
  }));
  if (measured.reduce((sum, row) => sum + row.size, 2) < 4000000) return null;
  const chunks: (typeof entities)[] = [];
  let chunk: typeof entities = [],
    size = 2;
  for (const row of measured) {
    if (row.size > 1000000)
      throw new Error("一つの記録が保存可能な大きさを超えています。");
    if (size + row.size > 1000000) {
      chunks.push(chunk);
      chunk = [];
      size = 2;
    }
    chunk.push(row.entity);
    size += row.size;
  }
  if (chunk.length) chunks.push(chunk);
  if (chunks.length > 32)
    throw new Error("記録全体が分割保存できる大きさを超えています。");
  return chunks;
}
