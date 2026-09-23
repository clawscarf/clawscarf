import type { ControlUiViewContext } from "openclaw/plugin-sdk/control-ui";
import { session } from "../../../services/access/generated/sdk.gen.js";
import { page as nativePage } from "../../common/native-page.js";
export {
  element,
  button,
  confirm,
  dialog,
  failure,
} from "../../common/native-page.js";
export function page(
  container: HTMLElement,
  context: ControlUiViewContext,
  title: string,
) {
  return nativePage(
    container,
    context,
    title,
    async (request) => (await session(request)).data,
  );
}
