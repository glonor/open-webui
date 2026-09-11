<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { getFileContentById } from '$lib/apis/files';
	import PdfPagesPreview from '$lib/components/common/PdfPagesPreview.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ArrowDownTray from '$lib/components/icons/ArrowDownTray.svelte';
	import type { SourcePreviewTarget } from '../sourcePreview';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let target: SourcePreviewTarget;

	let pdfPagesPreviewRef: PdfPagesPreview;
	let pdfData: ArrayBuffer | null = null;
	let error = '';
	let loadedFileId = '';
	let loadToken = 0;
	let handledRequestId = '';
	let attemptedRequestId = '';

	// Citation pages are zero-based; the PDF viewer uses one-based page numbers.
	$: targetPage = typeof target.page === 'number' ? target.page + 1 : null;

	$: if (
		target.fileId &&
		(target.fileId !== loadedFileId || (error && target.requestId !== attemptedRequestId))
	) {
		attemptedRequestId = target.requestId;
		void loadPdf(target.fileId);
	}

	$: if (pdfData && targetPage && pdfPagesPreviewRef && target.requestId !== handledRequestId) {
		handledRequestId = target.requestId;
		void pdfPagesPreviewRef.scrollToPage(targetPage);
	}

	const loadPdf = async (fileId: string) => {
		const token = ++loadToken;
		loadedFileId = fileId;
		pdfData = null;
		error = '';

		try {
			const data = await getFileContentById(fileId);
			if (token === loadToken) pdfData = data;
		} catch (e) {
			console.error('Failed to load cited PDF:', e);
			if (token === loadToken) error = $i18n.t('Failed to load file content.');
		}
	};

	onDestroy(() => {
		loadToken += 1;
	});

	const downloadPdf = () => {
		if (!pdfData) return;

		const url = URL.createObjectURL(new Blob([pdfData], { type: 'application/pdf' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = target.name;
		anchor.click();
		URL.revokeObjectURL(url);
	};
</script>

<div class="flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
	<div
		class="m-0 flex shrink-0 items-center gap-1 border-b border-gray-50 px-1 pb-1.5 pt-0 dark:border-gray-850/30"
	>
		<div
			class="min-w-0 flex-1 truncate px-1 text-xs text-gray-700 dark:text-gray-300"
			title={target.name}
		>
			{target.name}
		</div>
		<Tooltip content={$i18n.t('Download')}>
			<button
				type="button"
				class="flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors duration-100 {pdfData
					? 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-300'
					: 'cursor-default text-gray-200 dark:text-gray-700'}"
				on:click={downloadPdf}
				disabled={!pdfData}
				aria-label={$i18n.t('Download')}
			>
				<ArrowDownTray className="size-3" strokeWidth="1.4" />
			</button>
		</Tooltip>
	</div>

	<div class="min-h-0 flex-1 overflow-hidden">
		{#if error}
			<div class="flex h-full items-center justify-center p-6 text-sm text-red-500">{error}</div>
		{:else if pdfData}
			<PdfPagesPreview
				bind:this={pdfPagesPreviewRef}
				data={pdfData}
				{targetPage}
				className="h-full w-full"
			/>
		{:else}
			<div class="flex h-full items-center justify-center">
				<Spinner className="size-5" />
			</div>
		{/if}
	</div>
</div>
