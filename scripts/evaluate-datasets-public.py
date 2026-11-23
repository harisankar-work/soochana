"""Retrieve a pinned, class-balanced external sentiment fixture outside the checkout."""

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen
import zipfile

ARCHIVE = "https://archive.ics.uci.edu/static/public/331/sentiment+labelled+sentences.zip"
SHA256 = "afc26626d710899948693e1a61405dce197f57ffa719fa1130d346b4cc095343"
MEMBER = "sentiment labelled sentences/amazon_cells_labelled.txt"
SEED = "soochana-m10-public-amazon-24-v1"
CLASSES = {"0": "Negative", "1": "Positive"}


def retrieve(output: Path, archive_path: Path | None) -> None:
    if archive_path:
        archive = archive_path.read_bytes()
    else:
        with urlopen(ARCHIVE, timeout=30) as response:
            archive = response.read(2_000_000)
    if hashlib.sha256(archive).hexdigest() != SHA256:
        raise ValueError("Archive digest differs from the reviewed UCI release.")
    with zipfile.ZipFile(io.BytesIO(archive)) as zip_file:
        data = zip_file.read(MEMBER).decode("utf-8")

    candidates = {label: [] for label in CLASSES}
    for source_row, line in enumerate(data.splitlines(), start=1):
        text, label = line.rsplit("\t", maxsplit=1)
        text = text.strip()
        order = hashlib.sha256(f"{SEED}:{source_row}".encode()).hexdigest()
        candidates[label].append((order, source_row, text))

    if {key: len(values) for key, values in candidates.items()} != {"0": 500, "1": 500}:
        raise ValueError("Unexpected UCI class counts.")
    sample = sorted(
        (source_row, text, CLASSES[label])
        for label, rows in candidates.items()
        for _, source_row, text in sorted(rows)[:12]
    )
    normalized = {" ".join(text.lower().split()) for _, text, _ in sample}
    if len(normalized) != len(sample):
        raise ValueError("The pinned sample unexpectedly contains duplicate texts.")

    output.mkdir(parents=True, exist_ok=True)
    with (output / "public-amazon-24.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["Feedback", "Source", "External ID"])
        writer.writerows((text, "Amazon / UCI 331", f"uci-331-amazon-{source_row}") for source_row, text, _ in sample)

    expected = {
        "dataset": "UCI Sentiment Labelled Sentences, Amazon domain",
        "archiveSha256": SHA256,
        "license": "CC BY 4.0",
        "annotation": "Positive/negative sentence selection and labels by Kotzias et al.",
        "records": [
            {
                "id": f"feedback-row-{index}",
                "originalRow": index,
                "sourceId": f"uci-331-amazon-{source_row}",
                "originalText": text,
                "sentiment": sentiment,
                "topic": None,
                "outcome": "Accepted",
            }
            for index, (source_row, text, sentiment) in enumerate(sample, start=2)
        ],
    }
    (output / "public-amazon-24.reference.json").write_text(
        json.dumps(expected, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--archive", type=Path, help="Local copy of the pinned UCI ZIP")
    args = parser.parse_args()
    retrieve(args.output, args.archive)
