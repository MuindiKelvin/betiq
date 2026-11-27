import { useMemo, useRef } from "react";
import { Button, Modal } from "react-bootstrap";
import { downloadReceipt, layoutReceipt, receiptFile, receiptSvgParts } from "../lib/receipts";

// Shows a receipt as it will be printed in the PDF, before it is downloaded. It is drawn from the same layout the PDF is written from, and the
// "printed" time is fixed when the preview opens and reused by Download, so the file matches what is on screen.
// receipt: the receipt object (null = closed). opts: { leagueName, who, title, badge } as for downloadReceipt.
export default function ReceiptPreview({ receipt, opts = {}, onHide }) {
  const last = useRef(null);
  if (receipt) last.current = receipt;               // keep drawing it while the dialog fades out
  const shown = receipt ?? last.current;
  const now = useMemo(() => Date.now() / 1000, [receipt]);       // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => (shown ? layoutReceipt(shown, { ...opts, now }) : null), [shown, now]);   // eslint-disable-line react-hooks/exhaustive-deps
  const parts = useMemo(() => (layout ? receiptSvgParts(layout) : []), [layout]);
  return (
    <Modal show={!!receipt} onHide={onHide} centered scrollable contentClassName="iq-modal" aria-labelledby="receipt-preview-title">
      <Modal.Header closeButton>
        <Modal.Title as="h2" className="h5 mb-0" id="receipt-preview-title"><i className="bi bi-eye me-2 text-primary" />Preview{shown ? <span className="text-body-secondary fw-normal"> · {receiptFile(shown)}</span> : null}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {layout && (
          <div className="receipt-stage">
            <svg className="receipt-paper" viewBox={`0 0 ${layout.W} ${layout.H}`} role="img" aria-label={`Receipt ${shown.id}`} fontFamily={'"Courier New", Courier, "Liberation Mono", monospace'}>
              {parts.map((p, i) => (p.tag === "text" ? <text key={i} {...p.props}>{p.text}</text> : p.tag === "rect" ? <rect key={i} {...p.props} /> : <line key={i} {...p.props} />))}
            </svg>
          </div>)}
        <div className="tiny text-body-secondary mt-2">This is the PDF as it will be saved. Settled picks keep their result; pending ones are marked as such.</div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onHide}>Close</Button>
        <Button variant="primary" onClick={() => { downloadReceipt(receipt, { ...opts, now }); onHide(); }}><i className="bi bi-download me-1" />Download PDF</Button>
      </Modal.Footer>
    </Modal>
  );
}
