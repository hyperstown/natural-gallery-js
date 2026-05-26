import {Item} from '../Item';
import {GalleryOptions, ModelAttributes} from './AbstractGallery';
import {AbstractRowGallery} from './AbstractRowGallery';

export interface SquareGalleryOptions extends GalleryOptions {
    itemsPerRow: number;
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

export class Square<Model extends ModelAttributes = ModelAttributes> extends AbstractRowGallery<Model> {
    /**
     * Options after having been defaulted
     */
    declare protected options: Required<SquareGalleryOptions>;
    private readonly virtualItemPositions = new Map<Item<Model>, VirtualItemPosition>();
    private readonly virtualRows: VirtualRow[] = [];
    private readonly virtualRenderedItems = new WeakSet<Item<Model>>();
    private readonly virtualStyledItems = new WeakMap<Item<Model>, number>();
    private virtualFirstRenderedRow = -1;
    private virtualLastRenderedRow = -1;
    private virtualRenderFrame = 0;
    private virtualHeight = 0;
    private virtualLayoutVersion = 0;
    private virtualGalleryStartScrollTop = 0;

    constructor(elementRef: HTMLElement, options: SquareGalleryOptions, scrollElementRef?: HTMLElement | null) {
        super(elementRef, options, scrollElementRef);

        if (!options.itemsPerRow || options.itemsPerRow <= 0) {
            throw new Error('Option.itemsPerRow must be positive');
        }

        if (this.isVirtualScrollEnabled()) {
            this.elementRef.classList.add('virtual-scroll');
        }
    }

    /**
     * Compute sides with 1:1 ratio
     */
    public static organizeItems<T extends ModelAttributes>(
        gallery: Square<T>,
        items: Item<T>[],
        firstRowIndex = 0,
        toRow: number | null = null,
    ): void {
        const sideSize = gallery.getItemSideSize();
        let lastIndex = toRow ? gallery.options.itemsPerRow * (toRow - firstRowIndex + 1) : items.length;
        lastIndex = lastIndex > items.length ? items.length : lastIndex;

        for (let i = 0; i < lastIndex; i++) {
            const item = items[i];
            item.width = Math.floor(sideSize);
            item.height = Math.floor(sideSize);
            item.cropped = true;
            item.row = Math.floor(i / gallery.options.itemsPerRow) + firstRowIndex;
            item.style();
        }
    }

    public organizeItems(items: Item<Model>[], fromRow?: number, toRow?: number): void {
        Square.organizeItems(this, items, fromRow, toRow);
    }

    public addRows(rows: number): void {
        if (this.isVirtualScrollEnabled()) {
            this.requestItems(true);
            return;
        }

        super.addRows(rows);
    }

    protected endResize(): void {
        if (this.isVirtualScrollEnabled()) {
            this.bodyElementRef?.classList.remove('resizing');
            this.refreshVirtualLayout();
            this.renderVirtualWindow(true);
            this.flushBufferedItems();
            return;
        }

        super.endResize();
    }

    protected onItemsAdded(addToDom: boolean, collectionSize: number): void {
        if (!this.isVirtualScrollEnabled()) {
            super.onItemsAdded(addToDom, collectionSize);
            return;
        }

        this.refreshVirtualLayout();
        this.renderVirtualWindow(true);
        this.flushBufferedItems();
        this.updateNextButtonVisibility();
    }

    protected onScrollUpdate(): void {
        if (this.isVirtualScrollEnabled()) {
            this.scheduleVirtualRender();
        }
    }

    protected updateNextButtonVisibility(): void {
        if (this.isVirtualScrollEnabled()) {
            this.nextButton.style.display = 'none';
            return;
        }

        super.updateNextButtonVisibility();
    }

    protected shouldLoadMoreOnScroll(wrapperHeight: number): boolean {
        if (!this.isVirtualScrollEnabled()) {
            return super.shouldLoadMoreOnScroll(wrapperHeight);
        }

        return (
            this.getScrollTop() - this.virtualGalleryStartScrollTop + wrapperHeight >=
            this.virtualHeight + this.options.infiniteScrollOffset
        );
    }

    protected getEstimatedColumnsPerRow(): number {
        return this.options.itemsPerRow;
    }

    protected getEstimatedRowsPerPage(): number {
        return Math.ceil(this.getGalleryVisibleHeight() / this.getItemSideSize());
    }

    /**
     * Return square side size
     */
    protected getItemSideSize(): number {
        const itemsPerRow = this.getEstimatedColumnsPerRow();
        return (this.width - (itemsPerRow - 1) * this.options.gap) / itemsPerRow;
    }

    protected getFormatName(): string {
        return 'format-square';
    }

    private isVirtualScrollEnabled(): boolean {
        return this.options.virtualScroll && !this.options.rowsPerPage;
    }

    private refreshVirtualLayout(): void {
        if (!this.collection.length) {
            this.virtualItemPositions.clear();
            this.virtualRows.length = 0;
            this.virtualHeight = 0;
            this.virtualFirstRenderedRow = -1;
            this.virtualLastRenderedRow = -1;
            this.bodyElementRef.style.height = '';
            return;
        }

        this.organizeItems(this.collection);
        this.virtualItemPositions.clear();
        this.virtualRows.length = 0;
        this.virtualLayoutVersion++;
        this.virtualGalleryStartScrollTop = this.getGalleryStartScrollTop();

        const rowCount = this.collection[this.collection.length - 1].row + 1;
        for (let row = 0; row < rowCount; row++) {
            const startIndex = row * this.options.itemsPerRow;
            const endIndex = Math.min(startIndex + this.options.itemsPerRow, this.collection.length) - 1;
            const rowItems = this.collection.slice(startIndex, endIndex + 1);
            const top = row * (this.getItemSideSize() + this.options.gap);
            const rowWidth = rowItems.reduce((total, item) => total + item.width, 0);
            const gap = rowItems.length > 1 ? Math.max((this.width - rowWidth) / (rowItems.length - 1), 0) : 0;
            let left = 0;

            rowItems.forEach(item => {
                this.virtualItemPositions.set(item, {left, top});
                left += item.width + gap;
            });

            this.virtualRows.push({
                top,
                height: this.getItemSideSize(),
                startIndex,
                endIndex,
            });
        }

        const lastRow = this.virtualRows[this.virtualRows.length - 1];
        this.virtualHeight = lastRow.top + lastRow.height;
        this.bodyElementRef.style.height = `${this.virtualHeight}px`;
    }

    private scheduleVirtualRender(): void {
        if (this.virtualRenderFrame) {
            return;
        }

        const view = this.document.defaultView;
        const render = () => {
            this.virtualRenderFrame = 0;
            this.renderVirtualWindow();
        };

        if (!view) {
            render();
        } else if (view.requestAnimationFrame) {
            this.virtualRenderFrame = view.requestAnimationFrame(render);
        } else {
            this.virtualRenderFrame = view.setTimeout(render, 16);
        }
    }

    private renderVirtualWindow(force = false): void {
        if (!this.collection.length || !this.virtualRows.length) {
            return;
        }

        const galleryScrollTop = this.getScrollTop() - this.virtualGalleryStartScrollTop;
        const viewportTop = Math.max(galleryScrollTop, 0);
        const viewportBottom = viewportTop + this.getViewportHeight();
        const overscan = this.options.virtualScrollOverscanRows * (this.getItemSideSize() + this.options.gap);
        const firstRow = this.findFirstVirtualRow(viewportTop - overscan);
        const lastRow = this.findLastVirtualRow(viewportBottom + overscan);

        if (viewportBottom + overscan >= this.virtualHeight + this.options.infiniteScrollOffset) {
            this.requestItems(true);
        }

        if (!force && firstRow === this.virtualFirstRenderedRow && lastRow === this.virtualLastRenderedRow) {
            return;
        }

        const itemsToRender = this.collection.slice(
            this.virtualRows[firstRow].startIndex,
            this.virtualRows[lastRow].endIndex + 1,
        );
        const nextItems = new Set(itemsToRender);
        const currentItems = new Set(this.domCollection);

        this.domCollection.forEach(item => {
            if (!nextItems.has(item)) {
                item.remove();
            }
        });

        itemsToRender.forEach(item => {
            if (!currentItems.has(item) || item.rootElement?.parentElement !== this.bodyElementRef) {
                this.attachItemToDOM(item);
            }

            this.styleVirtualItem(item, force);

            if (!this.virtualRenderedItems.has(item)) {
                this.virtualRenderedItems.add(item);
                this.trackItemAddedToDOM(item, false);
            }
        });

        this._domCollection = itemsToRender;
        this.virtualFirstRenderedRow = firstRow;
        this.virtualLastRenderedRow = lastRow;
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

    private styleVirtualItem(item: Item<Model>, force = false): void {
        if (!force && this.virtualStyledItems.get(item) === this.virtualLayoutVersion) {
            return;
        }

        const position = this.virtualItemPositions.get(item);
        const element = item.rootElement;

        if (!position || !element) {
            return;
        }

        element.style.position = 'absolute';
        element.style.left = '0';
        element.style.top = '0';
        element.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
        this.virtualStyledItems.set(item, this.virtualLayoutVersion);
    }
}
