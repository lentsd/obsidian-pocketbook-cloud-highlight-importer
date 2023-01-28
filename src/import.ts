import { App, Notice, TFile } from 'obsidian';
import { PocketbookCloudApiClient, PocketbookCloudLoginClient } from './apiclient';
import { PocketbookCloudHighlightsImporterPluginSettings } from './settings';

var CFI = require('epub-cfi-resolver');

export class PocketbookCloudHighlightsImporter {
  login_client: PocketbookCloudLoginClient;
  api_client: PocketbookCloudApiClient;

  constructor(private app: App, private settings: PocketbookCloudHighlightsImporterPluginSettings) {
    this.login_client = new PocketbookCloudLoginClient(settings.username, settings.password, settings.shop_name, settings.access_token, settings.refresh_token);
    this.api_client = new PocketbookCloudApiClient(this.login_client);
  }

  async importHighlights() {
    new Notice('Importing highlights...');
    const books = await this.api_client.getBooks();

    for (const book of books) {
      const highlightIds = await this.api_client.getHighlightIdsForBook(book.fast_hash);

      const highlights = await Promise.all(highlightIds.map(highlightInfo => this.api_client.getHighlight(highlightInfo.uuid, book.fast_hash)));
      if (highlights.length > 0) {
        const sanitized_book_title = book.title.replace(/[^a-zA-Z0-9 \-]/g, '');
        const folder = `${this.settings.import_folder}/${sanitized_book_title}`;
        this.createFolder(folder);
        this.createFolder(`${folder}/highlights`);

        const metadata_filename = `${folder}/metadata.md`;

        // does not work for now, see API client comment
        //const cover_filename = `${folder}/cover.jpg`;
        //await this.writeFileBinary(cover_filename, await this.api_client.getBookCover(book));

        // write metadata file, which should be used to get all highlights together
        await this.writeFile(
          metadata_filename,
          `---
title: ${book.title}
authors: ${book.metadata.authors}
isbn: ${book.metadata.isbn}
year: ${book.metadata.year}
id: ${book.id}
fast_hash: ${book.fast_hash}
type: book
plugin: pocketbook-cloud-highlights-importer
---

\`\`\`dataview
LIST WITHOUT ID text
WHERE book_id=${book.id} AND type = "highlight" and plugin = "pocketbook-cloud-highlights-importer"
SORT sort_order
\`\`\`
`
        );

        try {
          // if sorting works, fine. if not, also fine, using date then.
          highlights.sort((a, b) => CFI.compare(this.cfi(a.quotation.begin), this.cfi(b.quotation.begin)));
        } catch (e) {
          highlights.sort((a, b) => +a.quotation.updated - +b.quotation.updated);
        }

        let i = 0;
        for (const highlight of highlights) {
          i++;
          const file_name = `${folder}/highlights/${highlight.uuid}.md`;
          const content = `---
id: ${highlight.uuid}
book_id: ${book.id}
book_fast_hash: ${book.fast_hash}
color: ${highlight.color?.value ?? 'unknown'}
note: ${highlight.note?.text ?? ''}
text: ${highlight.quotation?.text ?? ''}
pointer:
  begin: ${highlight.quotation?.begin ?? ''}
  end: ${highlight.quotation?.end ?? ''}
updated: ${highlight.quotation.updated}
type: highlight
plugin: pocketbook-cloud-highlights-importer
sort_order: ${i}
---
${highlight.quotation?.text ?? ''}

> [!note]
> ${highlight.note?.text ?? ''}

`;
          await this.writeFile(file_name, content);
        }
      }
    }
    new Notice('Import done');
  }

  private async createFolder(folder: string) {
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
  }

  private async writeFile(file_name: string, content: string) {
    let file = this.app.vault.getAbstractFileByPath(file_name) as TFile;
    if (!file) {
      file = await this.app.vault.create(file_name, '');
    }

    this.app.vault.modify(file, content);
  }

  private async writeFileBinary(file_name: string, content: ArrayBuffer) {
    let file = this.app.vault.getAbstractFileByPath(file_name) as TFile;
    if (!file) {
      file = await this.app.vault.createBinary(file_name, content);
    }

    this.app.vault.modifyBinary(file, content);
  }

  private cfi(cfi: string) {
    return new CFI(cfi.substring(cfi.indexOf('epubcfi')));
  }
}
