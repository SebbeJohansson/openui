/** An image attached to the composer, kept as a data URL until sent. */
export type Attachment = {
  id: string;
  filename: string;
  mime: string;
  dataUrl: string;
};
