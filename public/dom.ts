type QuerySelectable = {
  querySelector: typeof Element.prototype.querySelector;
};

export function $<E extends Node>(
  ExpectedElementConstructor: new () => E,
  selector: string,
  parent: QuerySelectable = document.body
): E {
  const element = parent.querySelector(selector);
  if (!element) {
    throw new Error(`Can't find element ${selector} on ${parent}.`);
  }

  if (!(element instanceof ExpectedElementConstructor)) {
    throw new Error(`Element ${selector} doesn't match the expected type.`);
  }

  return element;
}

export function $new(
  selector: string,
  parent: QuerySelectable = document.body
): DocumentFragment {
  const template = $(HTMLTemplateElement, selector, parent);
  const fragment = template.content.cloneNode(true);
  if (!(fragment instanceof DocumentFragment)) {
    throw new Error("Unexpected clone node result.");
  }

  return fragment;
}
