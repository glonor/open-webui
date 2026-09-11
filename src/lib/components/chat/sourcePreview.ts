export type SourcePreviewTarget = {
	chatId: string;
	messageId: string;
	fileId: string;
	name: string;
	page: number | null;
	requestId: string;
};

export type OpenSourcePreview = (target: SourcePreviewTarget) => void;

export const hasAlignedReferences = (sources: any[]) =>
	sources.every(
		(source) =>
			Array.isArray(source?.document) &&
			Array.isArray(source?.metadata) &&
			source.document.length === source.metadata.length &&
			source.metadata.every(
				(metadata: any) =>
					metadata &&
					typeof metadata === 'object' &&
					typeof (metadata.source || source?.source?.id || 'N/A') === 'string'
			)
	);

export const getExactPdfSourceTarget = (
	chatId: string,
	messageId: string,
	citation: any,
	referenceIndex: number,
	requestId: string
): SourcePreviewTarget | null => {
	if (!Number.isSafeInteger(referenceIndex) || referenceIndex < 0) return null;

	const metadata = citation?.metadata?.[referenceIndex];
	if (
		citation?.document?.[referenceIndex] === undefined ||
		!metadata ||
		typeof metadata !== 'object'
	)
		return null;

	const rawPage = metadata.page;
	const page =
		typeof rawPage === 'number' || (typeof rawPage === 'string' && rawPage.trim() !== '')
			? Number(rawPage)
			: NaN;
	if (!Number.isSafeInteger(page) || page < 0) return null;

	const fileId = metadata.file_id ?? citation?.source?.file?.id ?? null;
	const contentType = String(
		metadata.content_type ??
			metadata['Content-Type'] ??
			citation?.source?.content_type ??
			citation?.source?.file?.meta?.content_type ??
			''
	)
		.split(';')[0]
		.trim()
		.toLowerCase();
	const name = String(metadata.name ?? citation?.source?.name ?? '');
	if (
		typeof fileId !== 'string' ||
		!fileId ||
		metadata.external ||
		citation?.source?.type === 'external' ||
		(contentType !== 'application/pdf' && !name.toLowerCase().endsWith('.pdf'))
	) {
		return null;
	}

	return {
		chatId,
		messageId,
		fileId,
		name: name || 'PDF',
		page,
		requestId
	};
};
