import { decodeString, isValidHttpUrl } from '$lib/utils';

// A cited document is identified by its metadata source, falling back to the source id.
const getDocumentId = (source: any, index: number): string =>
	source?.metadata?.[index]?.source ?? source?.source?.id ?? 'N/A';

const getSavedNumber = (source: any, index: number): number | null => {
	const number = source?.citation_ids?.[index];
	return Number.isInteger(number) && number > 0 ? number : null;
};

/**
 * Groups a message's sources into one citation per document, each with the number the
 * model cites it by: the number saved with the source, or its position for sources saved
 * before numbers were shared across the chat.
 */
export const getCitations = (sources: any[] | null | undefined) => {
	const citations: any[] = [];

	for (const source of sources ?? []) {
		if (!source || Object.keys(source).length === 0) {
			continue;
		}

		(source.document ?? []).forEach((document: string, index: number) => {
			const metadata = source.metadata?.[index];
			const distance = source.distances?.[index];
			const id = getDocumentId(source, index);

			const existing = citations.find((citation) => citation.id === id);
			if (existing) {
				existing.document.push(document);
				existing.metadata.push(metadata);
				// Kept in step with the documents, as not every document has one
				existing.distances.push(distance);
				return;
			}

			const isUrl = id.startsWith('http://') || id.startsWith('https://');
			let _source = source.source;
			if (metadata?.name) {
				_source = { ..._source, name: metadata.name };
			}
			if (isUrl) {
				_source = { ..._source, name: metadata?.external ? _source?.name : id, url: id };
			}

			citations.push({
				id,
				number: getSavedNumber(source, index) ?? citations.length + 1,
				title: metadata?.name || (isUrl ? id : (source.source?.name ?? id)),
				source: _source,
				document: [document],
				metadata: [metadata],
				distances: [distance]
			});
		});
	}

	return citations;
};

export const resolveCitation = (citations: any[], id: string | number) => {
	const [group, ref] = String(id).split('#', 2);
	const citation = citations.find((item) => item.number === Number(group));
	if (!citation || !ref) return citation;

	const index = citation.metadata.findIndex((meta) => meta?.citation_ref === ref);
	if (index < 0) return citation;
	return {
		...citation,
		document: [citation.document[index]],
		metadata: [citation.metadata[index]],
		distances: [citation.distances[index]]
	};
};

const PASSAGE_PREVIEW_LIMIT = 400;

const getPassagePreview = (passage: string, isHtml: boolean): string => {
	let text = passage ?? '';
	if (isHtml) {
		const body = new DOMParser().parseFromString(text, 'text/html').body;
		body.querySelectorAll('script, style').forEach((element) => element.remove());
		text = body.textContent ?? '';
	}

	return text
		.trim()
		.slice(0, PASSAGE_PREVIEW_LIMIT)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/^\s*(?:#{1,6}|>)\s+/gm, '')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/\s+/g, ' ');
};

/** What a hovered citation shows: its title, and the passage the citation modal lists first. */
export const getCitationPreview = (citation: any) => {
	const { document, metadata, distances } = citation;
	const isRanked =
		distances.length === document.length &&
		distances.every((distance: any) => typeof distance === 'number');
	const index = isRanked ? distances.indexOf(Math.max(...distances)) : 0;
	const passageMetadata = metadata[index];

	const name = decodeString(citation.title);
	const url = isValidHttpUrl(citation.source?.url) ? citation.source.url : null;

	return {
		// A page is known by its title, or by its domain when it has none
		title: url
			? passageMetadata?.title || (isValidHttpUrl(name) ? new URL(url).hostname : name)
			: name,
		url,
		page: Number.isInteger(passageMetadata?.page) ? passageMetadata.page + 1 : null,
		passage: getPassagePreview(document[index], !!passageMetadata?.html)
	};
};

// [1], [1, 2] or [1#page]; not a link label like [1](url)
const CITATION_PATTERN = /\[(\d+(?:#[^,\]\s]+)?(?:,\s*\d+(?:#[^,\]\s]+)?)*)\](?!\()/g;

const getCitedIdentifiers = (content: string) => {
	const identifiers = new Set<string>();
	for (const segment of content.split(/(```[\s\S]*?```|`[\s\S]*?`)/)) {
		if (segment.startsWith('`')) {
			continue;
		}
		for (const match of segment.matchAll(CITATION_PATTERN)) {
			for (const part of match[1].split(',')) {
				identifiers.add(part.trim());
			}
		}
	}
	return identifiers;
};

/**
 * Sources from earlier turns that a message cites without having them itself. The model is
 * shown earlier tool results again, so it can cite their sources without fetching them anew.
 */
export const getCarriedSources = (
	messages: Record<string, any> | null | undefined,
	message: any
) => {
	const content = message?.content;
	if (typeof content !== 'string' || !content.includes('[')) {
		return [];
	}

	const citedIdentifiers = getCitedIdentifiers(content);
	const citedNumbers = new Set([...citedIdentifiers].map((id) => parseInt(id, 10)));
	for (const citation of getCitations(message.sources ?? message.citations)) {
		citedNumbers.delete(citation.number);
		for (const meta of citation.metadata) {
			if (meta?.citation_ref) citedIdentifiers.delete(`${citation.number}#${meta.citation_ref}`);
		}
	}
	if (citedNumbers.size === 0 && ![...citedIdentifiers].some((id) => id.includes('#'))) {
		return [];
	}

	const ancestors: any[] = [];
	const visited = new Set<string>();
	let parentId = message.parentId;
	while (parentId && messages?.[parentId] && !visited.has(parentId)) {
		visited.add(parentId);
		ancestors.push(messages[parentId]);
		parentId = messages[parentId].parentId;
	}
	ancestors.reverse();

	// Number the chain the way the backend does: a saved number wins, anything else takes the next.
	const numbers = new Map<string, number>();
	const carried = new Map<number, any[]>();
	const exact = new Map<string, any>();
	for (const ancestor of ancestors) {
		const found = new Map<number, any[]>();
		for (const source of ancestor.sources ?? []) {
			(source?.document ?? []).forEach((document: string, index: number) => {
				const id = getDocumentId(source, index);
				const saved = getSavedNumber(source, index);
				if (saved) {
					numbers.set(id, saved);
				} else if (!numbers.has(id)) {
					numbers.set(id, Math.max(0, ...numbers.values()) + 1);
				}

				const number = numbers.get(id) as number;
				const metadata = source.metadata?.[index];
				const idWithRef = `${number}#${metadata?.citation_ref}`;
				const groupCited = citedNumbers.has(number);
				const passageCited = metadata?.citation_ref && citedIdentifiers.has(idWithRef);
				if (!groupCited && !passageCited) {
					return;
				}

				const distance = source.distances?.[index];
				const passage = {
					source: source.source,
					document: [document],
					metadata: metadata ? [metadata] : [],
					distances: distance !== undefined ? [distance] : [],
					citation_ids: [number]
				};
				if (passageCited) exact.set(idWithRef, passage);
				if (groupCited) found.set(number, [...(found.get(number) ?? []), passage]);
			});
		}
		// When several turns hold a source, the latest is the copy the model saw last.
		for (const [number, sources] of found) {
			carried.set(number, sources);
		}
	}

	return [...new Set([...carried.values()].flat().concat([...exact.values()]))];
};
