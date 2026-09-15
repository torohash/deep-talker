import type { Env } from "./env";
import { ROOM_NAME } from "../shared/model";
export { TalkRoom } from "./room";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    if (URL.parse(request.url)!.pathname.startsWith("/api/")) {
      return env.ROOM.getByName(ROOM_NAME).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
