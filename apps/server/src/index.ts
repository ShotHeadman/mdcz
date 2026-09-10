import { runMaintenanceCli } from "./maintenanceCli";
import { startServer } from "./startServer";

const args = process.argv.slice(2);
void (args.length ? runMaintenanceCli(args) : startServer()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
