import {Masonry} from '../../src';
import {describe, expect, it} from 'vitest';
import {getContainerElement, getImages, scrollTo, setViewport} from './utils';
import {getBaseExpectedOptions, testGallery} from './abstract-gallery';

describe('Masonry Gallery', () => {
    testGallery(
        Masonry,
        {
            columnWidth: 400,
            gap: 4,
            ratioLimit: {
                min: 0.6,
                max: 0.8,
            },
        },
        {
            options: {
                ...getBaseExpectedOptions(),
                columnWidth: 400,
                infiniteScrollOffset: -563.3333333333334,
                ratioLimit: {
                    min: 0.6,
                    max: 0.8,
                },
            },
        },
    );

    it('should error with invalid column size', () => {
        const container = getContainerElement();
        expect(() => new Masonry(container, {columnWidth: -123})).toThrow('Option.columnWidth must be positive');
    });

    it('should virtualize masonry layout when enabled', async () => {
        setViewport(1000, 700);
        const container = getContainerElement(1000);
        const gallery = new Masonry(container, {columnWidth: 250, gap: 4, virtualScroll: true});

        gallery.addItems(getImages(100));

        expect(gallery.collection.length).toBe(100);
        expect(gallery.domCollection.length).toBeLessThan(100);
        expect(container.querySelectorAll('.figure').length).toBe(gallery.domCollection.length);
        expect(gallery.bodyElement.style.height).not.toBe('');

        const firstRenderedItem = gallery.domCollection[0];
        scrollTo(1800);
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(gallery.collection.length).toBe(100);
        expect(gallery.domCollection.length).toBeLessThan(100);
        expect(gallery.domCollection).not.toContain(firstRenderedItem);
        expect(container.querySelectorAll('.figure').length).toBe(gallery.domCollection.length);
    });
});
