import {Column} from '../Column';
import {Item} from '../Item';
import {getImageRatioAndIfCropped, RatioLimits} from '../Utility';
import {AbstractGallery, GalleryOptions, ModelAttributes} from './AbstractGallery';

export interface MasonryGalleryOptions extends GalleryOptions {
    columnWidth: number;
    ratioLimit?: RatioLimits;
}

interface VirtualItemPosition {
    left: number;
    top: number;
}

export class Masonry<Model extends ModelAttributes = ModelAttributes> extends AbstractGallery<Model> {
    /**
     * Options after having been defaulted
     */
    declare protected options: Required<MasonryGalleryOptions>;

    /**
     * Regroup the list of columns
     */
    protected columns: Column<Model>[] = [];
    private readonly virtualItemPositions = new Map<Item<Model>, VirtualItemPosition>();
    private readonly virtualRenderedItems = new WeakSet<Item<Model>>();
    private readonly virtualStyledItems = new WeakMap<Item<Model>, number>();
    private readonly virtualItemTops: number[] = [];
    private virtualFirstRenderedIndex = -1;
    private virtualLastRenderedIndex = -1;
    private virtualRenderFrame = 0;
    private virtualHeight = 0;
    private virtualLayoutVersion = 0;
    private virtualGalleryStartScrollTop = 0;
    private virtualMaxItemHeight = 0;

    constructor(elementRef: HTMLElement, options: MasonryGalleryOptions, scrollElementRef?: HTMLElement | null) {
        super(elementRef, options, scrollElementRef);

        if (!options.columnWidth || options.columnWidth <= 0) {
            throw new Error('Option.columnWidth must be positive');
        }

        if (this.isVirtualScrollEnabled()) {
            this.elementRef.classList.add('virtual-scroll');
        } else {
            this.addColumns();
        }

        /**
         * Setup scroll detection to prevent empty zones due to different heights
         */
        if (!this.options.infiniteScrollOffset) {
            let ratio = 0.5; // Portrait format to maximize estimated height

            // Better prediction using ratio if provided
            if (this.options.ratioLimit && this.options.ratioLimit.min) {
                ratio = this.options.ratioLimit.min;
            }

            const columnWidth = this.getColumnWidth();
            this.options.infiniteScrollOffset = (-1 * columnWidth) / ratio;
        }
    }

    /**
     * Compute sides with 1:1 ratio
     */
    public static organizeItems<T extends ModelAttributes>(
        gallery: Masonry<T>,
        items: Item<T>[],
        fromIndex = 0,
        toIndex: number | null = null,
    ): void {
        const itemsPerRow = gallery.getEstimatedColumnsPerRow();

        // Compute columnWidth of pictures
        const columnWidth = gallery.getColumnWidth();

        let lastIndex = toIndex ? itemsPerRow * (toIndex - fromIndex + 1) : items.length;
        lastIndex = lastIndex > items.length ? items.length : lastIndex;

        for (let i = 0; i < lastIndex; i++) {
            const item = items[i];
            const {ratio, cropped} = getImageRatioAndIfCropped(item.model, gallery.options.ratioLimit);

            item.width = Math.floor(columnWidth);
            item.height = item.width / ratio;
            item.cropped = cropped;
            item.style(); // todo : externalise to split dom manipulation and logic computing
        }
    }

    public organizeItems(items: Item<Model>[], fromRow?: number, toRow?: number): void {
        Masonry.organizeItems(this, items, fromRow, toRow);
    }

    protected onScroll(): void {
        if (this.isVirtualScrollEnabled()) {
            this.requestItems(true);
            return;
        }

        this.addUntilFill();
    }

    protected onPageAdd(): void {
        if (this.isVirtualScrollEnabled()) {
            this.requestItems(true);
            return;
        }

        this.addUntilFill();
    }

    protected getFormatName(): string {
        return 'format-masonry';
    }

    protected getEstimatedColumnsPerRow(): number {
        return Math.ceil((this.width - this.options.gap) / (this.options.columnWidth + this.options.gap));
    }

    protected getEstimatedRowsPerPage(): number {
        let ratio = 1.75; // ~16/9 - landscape format to minimum the height and maximize the prediction of the number of items

        // Better prediction using ratio if provided
        if (this.options.ratioLimit && this.options.ratioLimit.max) {
            ratio = this.options.ratioLimit.max;
        }

        const columnWidth = this.getColumnWidth();
        const estimatedImageHeight = columnWidth / ratio;
        return Math.ceil(this.getGalleryVisibleHeight() / estimatedImageHeight);
    }

    /**
     * Use current gallery height as reference. To fill free space it add images until the gallery height changes, then are one more row
     */
    protected addUntilFill(): void {
        do {
            this.addItemsToDom(1);
        } while (this.viewportIsNotFilled() && this.domCollection.length < this.collection.length);
    }

    protected addItemToDOM(item: Item<Model>): void {
        if (this.isVirtualScrollEnabled()) {
            super.addItemToDOM(item);
            return;
        }

        const shortestColumn = this.getShortestColumn();
        shortestColumn.addItem(item);
        super.addItemToDOM(item, shortestColumn.elementRef);
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

        if (!this.domCollection.length) {
            return;
        }

        // Compute with new width. Rows indexes may have changed
        this.domCollection.length = 0;
        this.addColumns();
        this.addUntilFill();
    }

    protected addColumns(): void {
        this.bodyElementRef.innerHTML = '';
        this.columns = [];
        const columnWidth = this.getColumnWidth();
        for (let i = 0; i < this.getEstimatedColumnsPerRow(); i++) {
            const columnRef = new Column<Model>(this.document, {width: columnWidth, gap: this.options.gap});
            this.columns.push(columnRef);
            this.bodyElementRef.appendChild(columnRef.elementRef);
        }
    }

    protected empty(): void {
        super.empty();
        if (this.isVirtualScrollEnabled()) {
            this.virtualItemPositions.clear();
            this.virtualItemTops.length = 0;
            this.virtualHeight = 0;
            this.virtualFirstRenderedIndex = -1;
            this.virtualLastRenderedIndex = -1;
            this.bodyElementRef.style.height = '';
        } else {
            this.addColumns();
        }
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

    /**
     * Returns true if at least one column doesn't overflow on the bottom of the viewport
     */
    private viewportIsNotFilled(): boolean {
        return this.columns.some(
            c => c.elementRef.getBoundingClientRect().bottom < this.document.documentElement.clientHeight,
        );
    }

    private addItemsToDom(nbItems: number) {
        const nbVisibleImages = this.domCollection.length;

        // Next row to add (first invisible row)
        const firstIndex = this.domCollection.length ? nbVisibleImages : 0;
        const lastWantedIndex = firstIndex + nbItems - 1;

        // Compute size only for elements we're going to add
        this.organizeItems(this.collection.slice(nbVisibleImages), firstIndex, lastWantedIndex);

        for (let i = nbVisibleImages; i < this.collection.length; i++) {
            const item = this.collection[i];
            if (i <= lastWantedIndex) {
                this.addItemToDOM(item);
            } else {
                break;
            }
        }

        this.flushBufferedItems();
        this.updateNextButtonVisibility();
    }

    /**
     * Return square side size
     */
    private getColumnWidth(): number {
        const itemsPerRow = this.getEstimatedColumnsPerRow();
        return Math.floor((this.width - (itemsPerRow - 1) * this.options.gap) / itemsPerRow);
    }

    private isVirtualScrollEnabled(): boolean {
        return this.options.virtualScroll && !this.options.rowsPerPage;
    }

    private refreshVirtualLayout(): void {
        if (!this.collection.length) {
            this.virtualItemPositions.clear();
            this.virtualItemTops.length = 0;
            this.virtualHeight = 0;
            this.virtualFirstRenderedIndex = -1;
            this.virtualLastRenderedIndex = -1;
            this.virtualMaxItemHeight = 0;
            this.bodyElementRef.style.height = '';
            return;
        }

        this.organizeItems(this.collection);
        this.virtualItemPositions.clear();
        this.virtualItemTops.length = 0;
        this.virtualLayoutVersion++;
        this.virtualGalleryStartScrollTop = this.getGalleryStartScrollTop();
        this.virtualMaxItemHeight = 0;

        const columns = Array.from({length: this.getEstimatedColumnsPerRow()}, (_, index) => ({
            left: index * (this.getColumnWidth() + this.options.gap),
            height: 0,
        }));

        this.collection.forEach(item => {
            const shortestColumn = columns.reduce((shortest, column) =>
                column.height < shortest.height ? column : shortest,
            );
            const top = shortestColumn.height;
            this.virtualItemPositions.set(item, {left: shortestColumn.left, top});
            this.virtualItemTops.push(top);
            shortestColumn.height += item.height + this.options.gap;
            this.virtualMaxItemHeight = Math.max(this.virtualMaxItemHeight, item.height);
        });

        this.virtualHeight = Math.max(...columns.map(column => Math.max(column.height - this.options.gap, 0)));
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
        if (!this.collection.length || !this.virtualItemTops.length) {
            return;
        }

        const galleryScrollTop = this.getScrollTop() - this.virtualGalleryStartScrollTop;
        const viewportTop = Math.max(galleryScrollTop, 0);
        const viewportBottom = viewportTop + this.getViewportHeight();
        const overscan = this.options.virtualScrollOverscanRows * (this.getColumnWidth() + this.options.gap);
        const firstCandidateIndex = this.findFirstVirtualItem(viewportTop - overscan - this.virtualMaxItemHeight);
        const lastCandidateIndex = this.findLastVirtualItem(viewportBottom + overscan);

        if (viewportBottom + overscan >= this.virtualHeight + this.options.infiniteScrollOffset) {
            this.requestItems(true);
        }

        if (
            !force &&
            firstCandidateIndex === this.virtualFirstRenderedIndex &&
            lastCandidateIndex === this.virtualLastRenderedIndex
        ) {
            return;
        }

        const itemsToRender = this.collection.slice(firstCandidateIndex, lastCandidateIndex + 1);
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
        this.virtualFirstRenderedIndex = firstCandidateIndex;
        this.virtualLastRenderedIndex = lastCandidateIndex;
    }

    private findFirstVirtualItem(top: number): number {
        const wantedTop = Math.max(top, 0);
        let low = 0;
        let high = this.virtualItemTops.length - 1;
        let result = high;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);

            if (this.virtualItemTops[middle] >= wantedTop) {
                result = middle;
                high = middle - 1;
            } else {
                low = middle + 1;
            }
        }

        return result;
    }

    private findLastVirtualItem(bottom: number): number {
        let low = 0;
        let high = this.virtualItemTops.length - 1;
        let result = 0;

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);

            if (this.virtualItemTops[middle] <= bottom) {
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

    private getShortestColumn(): Column<Model> {
        return this.columns.reduce((shortestColumn, column) => {
            if (!shortestColumn) {
                return column;
            }

            return column.height < shortestColumn.height ? column : shortestColumn;
        });
    }
}
