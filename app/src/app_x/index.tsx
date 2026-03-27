import { getShaX } from "./config/sha_x";

export default function AppX() {
  return <pre>{JSON.stringify(getShaX(), null, 2)}</pre>;
}
