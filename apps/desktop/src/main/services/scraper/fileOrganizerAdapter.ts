import { FileOrganizer } from "@mdcz/runtime/scrape";
import { loggerService } from "../LoggerService";

export const fileOrganizer = new FileOrganizer(loggerService.getLogger("FileOrganizer"));
