import { applyCommand } from "../domain/world";
self.onmessage = (event) => {
  const { world, command, id } = event.data;
  try {
    self.postMessage({ id, state: applyCommand(world, command, id) });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "計算に失敗しました。",
    });
  }
};
