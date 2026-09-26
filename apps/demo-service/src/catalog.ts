/**
 * @file      apps/demo-service/src/catalog.ts
 * @phase     P3
 * @owner     Product & Experience
 * @purpose   Static, public-domain book catalog (no personal or confidential data — hackathon data rules).
 * @depends   —
 * @usedBy    ./app.ts
 * @agentNotes Tests expect exactly 6 books and at least one featured book.
 */
export interface Book {
  id: string;
  title: string;
  author: string;
  year: number;
  featured: boolean;
}

export const BOOKS: Book[] = [
  { id: 'b1', title: 'Pride and Prejudice', author: 'Jane Austen', year: 1813, featured: true },
  { id: 'b2', title: 'Moby-Dick', author: 'Herman Melville', year: 1851, featured: false },
  { id: 'b3', title: 'Frankenstein', author: 'Mary Shelley', year: 1818, featured: true },
  { id: 'b4', title: 'The Time Machine', author: 'H. G. Wells', year: 1895, featured: true },
  { id: 'b5', title: 'Little Women', author: 'Louisa May Alcott', year: 1868, featured: false },
  { id: 'b6', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', year: 1892, featured: false },
];
