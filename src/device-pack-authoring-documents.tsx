import { Plus, Trash2 } from "lucide-react";
import {
  addDocument,
  removeDocument,
  updateDocument,
} from "./device-pack-authoring-advanced-draft";
import type { DevicePack } from "./types";

type Props = {
  pack: DevicePack;
  language: "zh-CN" | "en";
  onChange: (pack: DevicePack) => void;
};

export function DevicePackAuthoringDocuments({
  pack,
  language,
  onChange,
}: Props) {
  const zh = language === "zh-CN";
  return (
    <section className="pack-author-documents">
      <div className="pack-author-subheading">
        <strong>{zh ? "资料来源" : "Source documents"}</strong>
        <button onClick={() => onChange(addDocument(pack))}>
          <Plus />
          {zh ? "添加资料" : "Add document"}
        </button>
      </div>
      <div className="pack-author-document-list">
        {pack.documents.map((document, index) => (
          <div key={`${document.kind}-${index}`}>
            <input
              value={document.kind}
              onChange={(event) =>
                onChange(
                  updateDocument(pack, index, { kind: event.target.value }),
                )
              }
              placeholder="datasheet"
            />
            <input
              value={document.title}
              onChange={(event) =>
                onChange(
                  updateDocument(pack, index, { title: event.target.value }),
                )
              }
              placeholder={zh ? "资料标题" : "Document title"}
            />
            <input
              value={document.sourceUrl}
              onChange={(event) =>
                onChange(
                  updateDocument(pack, index, {
                    sourceUrl: event.target.value,
                  }),
                )
              }
              placeholder="https://"
            />
            <input
              value={document.revision ?? ""}
              onChange={(event) =>
                onChange(
                  updateDocument(pack, index, { revision: event.target.value }),
                )
              }
              placeholder={zh ? "修订" : "Revision"}
            />
            <input
              value={document.license ?? ""}
              onChange={(event) =>
                onChange(
                  updateDocument(pack, index, { license: event.target.value }),
                )
              }
              placeholder={zh ? "许可证" : "License"}
            />
            <button
              onClick={() => onChange(removeDocument(pack, index))}
              aria-label={zh ? "删除资料" : "Remove document"}
            >
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
