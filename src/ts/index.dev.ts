import "./index";
import { Editor } from "./types";

const container = document.querySelector("#app");
const container2 = document.querySelector("#app2");
if (container && container2) {
  const editor = document.createElement("erd-editor") as Editor;
  const editor2 = document.createElement("erd-editor") as Editor;

  editor.subscribe(commands => {
    console.log("editor pull");
    editor2.next(commands);
  });
  editor2.subscribe(commands => {
    console.log("editor2 pull");
    editor.next(commands);
  });
  editor2.blur();

  container.appendChild(editor);
  container2.appendChild(editor2);
}