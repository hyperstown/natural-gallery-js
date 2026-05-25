import {Item} from '../Item';
import {getImageRatio, getImageRatioAndIfCropped, RatioLimits} from '../Utility';
import {GalleryOptions, ModelAttributes, SizedModel} from './AbstractGallery';
import {AbstractRowGallery} from './AbstractRowGallery';

export interface NaturalGalleryOptions extends GalleryOptions {
    rowHeight: number;
    ratioLimit?: RatioLimits;
}

interface VirtualRow {
    top: number;
    height: number;
    startIndex: number;
    endIndex: number;
}

interface VirtualItemPosition {
    left: number;
    top: number;
}

export class Natural<Model extends ModelAttributes = ModelAttributes> extends AbstractRowGallery<Model> {
    /**
     * Options after having been defaulted
     */
    declare protected options: Required<NaturalGalleryOptions>;
    private readonly virtualItemPositions = new Map<Item<Model>, VirtualItemPosition>();
    private readonly virtualRows: VirtualRow[] = [];
    private readonly virtualRenderedItems = new WeakSet<Item<Model>>();
    private virtualHeight = 0;

    constructor(elementRef: HTMLElement, options: NaturalGalleryOptions, scrollElementRef?: HTMLElement | null) {
        super(elementRef, options, scrollElementRef);
        if (!options.rowHeight || options.rowHeight <= 0) {
            throw new Error('Option.rowHeight must be positive');
        }

        if (this.isVirtualScrollEnabled()) {
            this.elementRef.classList.add('virtual-scroll');
        }
    }

    public static organizeItems<T extends ModelAttributes>(
        gallery: Natural<T>,
        items: Item<T>[],
        fromRow = 0,
        toRow: number | null = null,
        currentRow: number | null = null,
    ): void {
        if (!currentRow) {
            currentRow = fromRow ? fromRow : 0;
        }

        const options = gallery.options;

        for (let chunkSize = 1; chunkSize <= items.length; chunkSize++) {
            const chunk = items.slice(0, chunkSize);
            const rowWidth = this.getRowWidth(
                chunk.map(c => c.model),
                options.rowHeight,
                options.gap,
                options.ratioLimit,
            );

            if (rowWidth >= gallery.width) {
                // if end of row

                this.computeSizes(chunk, gallery.width, options.gap, currentRow, null, options.ratioLimit);

                const nextRow = currentRow + 1;
                if (toRow === null || nextRow <= toRow) {
                    Natural.organizeItems(gallery, items.slice(chunkSize), fromRow, toRow, nextRow);
                }

                break;
            } else if (chunkSize === items.length) {
                // if end of list
                // the width is not fixed as we have not enough items
                // size of images are indexed on max row height.
                this.computeSizes(chunk, null, options.gap, currentRow, options.rowHeight, options.ratioLimit);
                break;
            }
        }
    }

    /**
     * Compute sizes for given images to fit in given row width
     * Items are updated
     */
    public static computeSizes<T extends ModelAttributes>(
        chunk: Item<T>[],
        containerWidth: number | null,
        margin: number,
        row: number,
        maxRowHeight: number | null = null,
        ratioLimits?: RatioLimits,
    ): void {
        const chunkModels = chunk.map(c => c.model);
        const rowHeight = containerWidth
            ? this.getRowHeight(chunkModels, containerWidth, margin, ratioLimits)
            : (maxRowHeight ?? 0);
        const rowWidth = this.getRowWidth(chunkModels, rowHeight, margin, ratioLimits);

        // Overflowed pixels
        const apportion = (rowWidth - (containerWidth ?? 0)) / chunk.length;
        const excess = containerWidth ? apportion : 0;
        let decimals = 0;

        for (let i = 0; i < chunk.length; i++) {
            const item = chunk[i];
            const {ratio, cropped} = getImageRatioAndIfCropped(item.model, ratioLimits);
            let width = ratio * rowHeight - excess;
            decimals += width - Math.floor(width);
            width = Math.floor(width);

            if (decimals >= 1 || (i === chunk.length - 1 && Math.round(decimals) === 1)) {
                width++;
                decimals--;
            }

            item.width = width;
            item.height = Math.floor(rowHeight);
            item.cropped = cropped;
            item.row = row;
            item.style();
        }
    }

    public static getRowWidth(
        models: SizedModel[],
        maxRowHeight: number,
        margin: number,
        ratioLimits?: RatioLimits,
    ): number {
        return margin * (models.length - 1) + this.getRatios(models, ratioLimits) * maxRowHeight;
    }

    public static getRowHeight(
        models: SizedModel[],
        containerWidth: number,
        margin: number,
        ratioLimits?: RatioLimits,
    ): number {
        return (containerWidth - margin * (models.length - 1)) / this.getRatios(models, ratioLimits);
    }

    /**
     * Return the ratio format of models as if they were a single image
     */
    public static getRatios(models: SizedModel[], ratioLimits?: RatioLimits): number {
        return models.reduce((total, model) => total + getImageRatio(model, ratioLimits), 0);
    }

    public addRows(rows: number): void {
        if (this.isVirtualScrollEnabled()) {
            this.requestItems(true);
            return;
        }

        this.completeLastRow();
        super.addRows(rows);
    }

    public organizeItems(items: Item<Model>[], fromRow?: number, toRow?: number): void {
        Natural.organizeItems(this, items, fromRow, toRow);
    }

    protected getFormatName(): string {
        return 'format-natural';
    }

    protected endResize(): void {
        if (this.isVirtualScrollEnabled()) {
            this.bodyElementRef?.classList.remove('resizing');
            this.refreshVirtualLayout();
            this.renderVirtualWindow();
            this.flushBufferedItems();
            return;
        }

        super.endResize();
        this.completeLastRow();
        this.flushBufferedItems();
    }

    protected onItemsAdded(addToDom: boolean, collectionSize: number): void {
        if (!this.isVirtualScrollEnabled()) {
            super.onItemsAdded(addToDom, collectionSize);
            return;
        }

        this.refreshVirtualLayout();
        this.renderVirtualWindow();
        this.flushBufferedItems();
        this.updateNextButtonVisibility();
    }

    protected onScrollUpdate(): void {
        if (!this.isVirtualScrollEnabled()) {
            return;
        }

        this.renderVirtualWindow();
    }

    protected updateNextButtonVisibility(): void {
        if (this.isVirtualScrollEnabled()) {
            this.nextButton.style.display = 'none';
            return;
        }

        super.updateNextButtonVisibility();
    }

    protected getEstimatedColumnsPerRow(): number {
        let ratio = 1;

        // Better prediction using ratio if provided
        if (this.options.ratioLimit && this.options.ratioLimit.min) {
            ratio = this.options.ratioLimit.min;
        }

        return Math.ceil(((1 / ratio) * this.width + this.options.gap) / (this.options.rowHeight + this.options.gap));
    }

    protected getEstimatedRowsPerPage(): number {
        return Math.ceil(this.getGalleryVisibleHeight() / (this.options.rowHeight + this.options.gap)) + 1;
    }

    private isVirtualScrollEnabled(): boolean {
        return this.options.virtualScroll && !this.options.rowsPerPage;
    }

    private refreshVirtualLayout(): void {
        if (!this.collection.length) {
            this.virtualItemPositions.clear();
            this.virtualRows.length = 0;
            this.virtualHeight = 0;
            this.bodyElementRef.style.height = '';
            return;
        }

        this.organizeItems(this.collection, 0);
        this.virtualItemPositions.clear();
        this.virtualRows.length = 0;

        let rowTop = 0;
        let rowStartIndex = 0;
        let rowItems: Item<Model>[] = [];
        let currentRow = this.collection[0].row;

        const commitRow = (endIndex: number): void => {
            const rowHeight = Math.max(...rowItems.map(item => item.height));
            const rowWidth = rowItems.reduce((total, item) => total + item.width, 0);
            const gap =
                rowItems.length > 1 ? Math.max((this.width - rowWidth) / (rowItems.length - 1), 0) : 0;
            let left = 0;

            rowItems.forEach(item => {
                this.virtualItemPositions.set(item, {left, top: rowTop});
                left += item.width + gap;
            });

            this.virtualRows.push({
                top: rowTop,
                height: rowHeight,
                startIndex: rowStartIndex,
                endIndex,
            });
            rowTop += rowHeight + this.options.gap;
        };

        this.collection.forEach((item, index) => {
            if (item.row !== currentRow) {
                commitRow(index - 1);
                rowStartIndex = index;
                rowItems = [];
                currentRow = item.row;
            }

            rowItems.push(item);
        });

        commitRow(this.collection.length - 1);
        const lastRow = this.virtualRows[this.virtualRows.length - 1];
        this.virtualHeight = lastRow.top + lastRow.height;
        this.bodyElementRef.style.height = `${this.virtualHeight}px`;
    }

    private renderVirtualWindow(): void {
        if (!this.collection.length || !this.virtualRows.length) {
            return;
        }

        const galleryScrollTop = this.getScrollTop() - this.elementRef.offsetTop;
        const viewportTop = Math.max(galleryScrollTop, 0);
        const viewportBottom = viewportTop + this.getViewportHeight();
        const overscan = this.options.virtualScrollOverscanRows * (this.options.rowHeight + this.options.gap);
        const firstRow = this.findFirstVirtualRow(viewportTop - overscan);
        const lastRow = this.findLastVirtualRow(viewportBottom + overscan);
        const itemsToRender = this.collection.slice(
            this.virtualRows[firstRow].startIndex,
            this.virtualRows[lastRow].endIndex + 1,
        );
        const nextItems = new Set(itemsToRender);

        this.domCollection.forEach(item => {
            if (!nextItems.has(item)) {
                item.remove();
            }
        });

        itemsToRender.forEach(item => {
            this.attachItemToDOM(item);
            this.styleVirtualItem(item);

            if (!this.virtualRenderedItems.has(item)) {
                this.virtualRenderedItems.add(item);
                this.trackItemAddedToDOM(item, false);
            }
        });

        this._domCollection = itemsToRender;

        if (viewportBottom + overscan >= this.virtualHeight + this.options.infiniteScrollOffset) {
            this.requestItems(true);
        }
    }

    private findFirstVirtualRow(top: number): number {
        const wantedTop = Math.max(top, 0);
        let low = 0;
        let high = this.virtualRows.length - 1;
        let result = high;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const row = this.virtualRows[middle];

            if (row.top + row.height >= wantedTop) {
                result = middle;
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }

        return result;
    }

    private findLastVirtualRow(bottom: number): number {
        let low = 0;
        let high = this.virtualRows.length - 1;
        let result = 0;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const row = this.virtualRows[middle];

            if (row.top <= bottom) {
                result = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        return result;
    }

    private styleVirtualItem(item: Item<Model>): void {
        const position = this.virtualItemPositions.get(item);
        const element = item.rootElement;

        if (!position || !element) {
            return;
        }

        element.style.position = 'absolute';
        element.style.left = '0';
        element.style.top = '0';
        element.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
    }

    private completeLastRow(): void {
        if (!this.domCollection.length) {
            return;
        }

        // Get last row number
        const lastVisibleRow = this.domCollection[this.domCollection.length - 1].row;

        // Get number of items in that last row
        const visibleItemsInLastRow = this.domCollection.filter(i => i.row === lastVisibleRow).length;

        // Get a list from first item of last row until end of collection
        const collectionFromLastVisibleRow = this.collection.slice(this.domCollection.length - visibleItemsInLastRow);
        this.organizeItems(
            collectionFromLastVisibleRow,
            collectionFromLastVisibleRow[0].row,
            collectionFromLastVisibleRow[0].row,
        );
        const itemsToAdd = collectionFromLastVisibleRow
            .slice(visibleItemsInLastRow)
            .filter(i => i.row <= collectionFromLastVisibleRow[0].row);

        itemsToAdd.forEach(i => this.addItemToDOM(i));
    }
}
