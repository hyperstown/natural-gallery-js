import {ModelAttributes, Square} from '../../src';
import {describe, expect, it} from 'vitest';
import {getContainerElement, getImages, getSize, scrollTo, setViewport} from './utils';
import {getBaseExpectedOptions, testGallery} from './abstract-gallery';

describe('Square Gallery', () => {
    testGallery(
        Square,
        {itemsPerRow: 4, gap: 4},
        {
            maxItemsInDom: 16,
            itemsAfterScroll: 20,
            itemsInFirstPage: 16,
            itemsInSecondPage: 32,
            options: {
                ...getBaseExpectedOptions(),
                itemsPerRow: 4,
            },
        },
    );

    it('should error with invalid column size', () => {
        const container = getContainerElement();
        expect(() => new Square(container, {itemsPerRow: -5})).toThrow('Option.itemsPerRow must be positive');
    });

    it('should organize items that dont fill the line', () => {
        const images: ModelAttributes[] = [
            {
                thumbnailSrc: 'foo.jpg',
                enlargedWidth: 6000,
                enlargedHeight: 4000,
            },
            {
                thumbnailSrc: 'bar.jpg',
                enlargedWidth: 3648,
                enlargedHeight: 5472,
            },
        ];

        const container = getContainerElement();
        const gallery = new Square(container, {itemsPerRow: 4});

        gallery.addItems(images);
        gallery.organizeItems(gallery.collection);

        const result = [
            {width: 253, height: 253, row: 0},
            {width: 253, height: 253, row: 0},
        ];

        expect(gallery.collection.map(getSize)).toEqual(result);
    });

    it('should organize items that overflow line', () => {
        const images: ModelAttributes[] = [
            {
                thumbnailSrc: 'foo.jpg',
                enlargedWidth: 6000,
                enlargedHeight: 4000,
            },
            {
                thumbnailSrc: 'bar.jpg',
                enlargedWidth: 1356,
                enlargedHeight: 1234,
            },
            {
                thumbnailSrc: 'foobar.jpg',
                enlargedWidth: 3648,
                enlargedHeight: 5472,
            },
            {
                thumbnailSrc: 'barfoo.jpg',
                enlargedWidth: 3000,
                enlargedHeight: 2000,
            },
            {
                thumbnailSrc: 'barbar.jpg',
                enlargedWidth: 3000,
                enlargedHeight: 2000,
            },
        ];

        const container = getContainerElement();
        const gallery = new Square(container, {itemsPerRow: 4});

        gallery.addItems(images);
        gallery.organizeItems(gallery.collection);

        const result = [
            {width: 253, height: 253, row: 0},
            {width: 253, height: 253, row: 0},
            {width: 253, height: 253, row: 0},
            {width: 253, height: 253, row: 0},
            {width: 253, height: 253, row: 1},
        ];

        expect(gallery.collection.map(getSize)).toEqual(result);
    });

    it('should virtualize square layout when enabled', async () => {
        setViewport(1000, 700);
        const container = getContainerElement(1000);
        const gallery = new Square(container, {itemsPerRow: 4, gap: 4, virtualScroll: true});

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
