# Milestone 4.1 clustering evaluation

The frozen MiniLM checkpoint generated real 384-dimensional vectors in the browser worker. The development set combines the original 48 reviews with nine newly written examples. The holdout contains 46 separately written examples. All labels were assigned before inference by the implementing assistant and lack independent review. The 0.80 development precision floor was set before the comparison. No configuration met it, so complete-link at 0.75 remains the default. The highest-development-F1 alternative, average-link at 0.45, was fixed for exploratory comparison before running the holdout.

TP counts predicted pairs with the same reference topic. FP counts predicted pairs with different topics, and FN counts reference pairs split across groups or left ungrouped. Distinct outlier labels never constitute a reference pair. Precision is reported as zero when a method predicts no pairs. Mean cohesion is the unweighted mean of the recurring groups' mean within-group cosine similarity. Timings measure a single clustering pass over a precomputed matrix on the cloud host and are illustrative.

## Development sweep (57 reviews)

| Method | Cutoff | Precision | Recall | F1 | TP | FP | FN | Groups | Singletons | Largest | Mean cohesion | ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| complete-link-v1 | 0.40 | 0.547 | 0.423 | 0.477 | 47 | 39 | 64 | 13 | 7 | 6 | 0.575 | 2.659 |
| complete-link-v1 | 0.45 | 0.517 | 0.270 | 0.355 | 30 | 28 | 81 | 16 | 10 | 6 | 0.595 | 0.667 |
| complete-link-v1 | 0.50 | 0.500 | 0.234 | 0.319 | 26 | 26 | 85 | 15 | 13 | 5 | 0.606 | 0.634 |
| complete-link-v1 | 0.55 | 0.486 | 0.162 | 0.243 | 18 | 19 | 93 | 12 | 23 | 5 | 0.644 | 0.552 |
| complete-link-v1 | 0.60 | 0.577 | 0.135 | 0.219 | 15 | 11 | 96 | 12 | 27 | 4 | 0.661 | 0.499 |
| complete-link-v1 | 0.65 | 0.444 | 0.036 | 0.067 | 4 | 5 | 107 | 7 | 42 | 3 | 0.728 | 0.342 |
| complete-link-v1 | 0.70 | 0.429 | 0.027 | 0.051 | 3 | 4 | 108 | 5 | 46 | 3 | 0.754 | 0.349 |
| complete-link-v1 | 0.75 | 0.667 | 0.018 | 0.035 | 2 | 1 | 109 | 3 | 51 | 2 | 0.789 | 0.313 |
| complete-link-v1 | 0.80 | 0.000 | 0.000 | 0.000 | 0 | 1 | 111 | 1 | 55 | 2 | 0.827 | 0.383 |
| complete-link-v1 | 0.85 | 0.000 | 0.000 | 0.000 | 0 | 0 | 111 | 0 | 57 | 0 | — | 0.162 |
| average-link-v1 | 0.40 | 0.366 | 0.739 | 0.490 | 82 | 142 | 29 | 7 | 7 | 17 | 0.537 | 2.698 |
| average-link-v1 | 0.45 | 0.571 | 0.577 | 0.574 | 64 | 48 | 47 | 10 | 8 | 8 | 0.561 | 2.712 |
| average-link-v1 | 0.50 | 0.582 | 0.414 | 0.484 | 46 | 33 | 65 | 12 | 11 | 6 | 0.592 | 5.222 |
| average-link-v1 | 0.55 | 0.574 | 0.279 | 0.376 | 31 | 23 | 80 | 10 | 22 | 6 | 0.637 | 1.939 |
| average-link-v1 | 0.60 | 0.545 | 0.162 | 0.250 | 18 | 15 | 93 | 12 | 25 | 5 | 0.657 | 1.625 |
| average-link-v1 | 0.65 | 0.533 | 0.072 | 0.127 | 8 | 7 | 103 | 6 | 41 | 4 | 0.709 | 1.039 |
| average-link-v1 | 0.70 | 0.429 | 0.027 | 0.051 | 3 | 4 | 108 | 5 | 46 | 3 | 0.754 | 0.708 |
| average-link-v1 | 0.75 | 0.667 | 0.018 | 0.035 | 2 | 1 | 109 | 3 | 51 | 2 | 0.789 | 0.441 |
| average-link-v1 | 0.80 | 0.000 | 0.000 | 0.000 | 0 | 1 | 111 | 1 | 55 | 2 | 0.827 | 0.233 |
| average-link-v1 | 0.85 | 0.000 | 0.000 | 0.000 | 0 | 0 | 111 | 0 | 57 | 0 | — | 0.132 |
| centroid-link-v1 | 0.40 | 0.104 | 0.982 | 0.188 | 109 | 942 | 2 | 3 | 3 | 46 | 0.511 | 3.075 |
| centroid-link-v1 | 0.45 | 0.242 | 0.937 | 0.385 | 104 | 325 | 7 | 5 | 5 | 26 | 0.513 | 1.406 |
| centroid-link-v1 | 0.50 | 0.250 | 0.883 | 0.390 | 98 | 294 | 13 | 5 | 7 | 25 | 0.518 | 1.476 |
| centroid-link-v1 | 0.55 | 0.248 | 0.766 | 0.374 | 85 | 258 | 26 | 5 | 11 | 24 | 0.534 | 1.325 |
| centroid-link-v1 | 0.60 | 0.377 | 0.523 | 0.438 | 58 | 96 | 53 | 7 | 18 | 15 | 0.596 | 1.329 |
| centroid-link-v1 | 0.65 | 0.605 | 0.234 | 0.338 | 26 | 17 | 85 | 6 | 33 | 6 | 0.665 | 0.884 |
| centroid-link-v1 | 0.70 | 0.538 | 0.063 | 0.113 | 7 | 6 | 104 | 4 | 45 | 4 | 0.732 | 0.285 |
| centroid-link-v1 | 0.75 | 0.400 | 0.018 | 0.034 | 2 | 3 | 109 | 3 | 50 | 3 | 0.769 | 0.135 |
| centroid-link-v1 | 0.80 | 0.000 | 0.000 | 0.000 | 0 | 1 | 111 | 1 | 55 | 2 | 0.827 | 0.128 |
| centroid-link-v1 | 0.85 | 0.000 | 0.000 | 0.000 | 0 | 0 | 111 | 0 | 57 | 0 | — | 0.085 |
| mutual-nearest-v1 | 0.40 | 0.636 | 0.063 | 0.115 | 7 | 4 | 104 | 11 | 35 | 2 | 0.698 | 0.349 |
| mutual-nearest-v1 | 0.45 | 0.636 | 0.063 | 0.115 | 7 | 4 | 104 | 11 | 35 | 2 | 0.698 | 0.218 |
| mutual-nearest-v1 | 0.50 | 0.636 | 0.063 | 0.115 | 7 | 4 | 104 | 11 | 35 | 2 | 0.698 | 0.207 |
| mutual-nearest-v1 | 0.55 | 0.636 | 0.063 | 0.115 | 7 | 4 | 104 | 11 | 35 | 2 | 0.698 | 0.452 |
| mutual-nearest-v1 | 0.60 | 0.636 | 0.063 | 0.115 | 7 | 4 | 104 | 11 | 35 | 2 | 0.698 | 0.531 |
| mutual-nearest-v1 | 0.65 | 0.571 | 0.036 | 0.068 | 4 | 3 | 107 | 7 | 43 | 2 | 0.737 | 0.098 |
| mutual-nearest-v1 | 0.70 | 0.600 | 0.027 | 0.052 | 3 | 2 | 108 | 5 | 47 | 2 | 0.766 | 0.078 |
| mutual-nearest-v1 | 0.75 | 0.667 | 0.018 | 0.035 | 2 | 1 | 109 | 3 | 51 | 2 | 0.789 | 0.073 |
| mutual-nearest-v1 | 0.80 | 0.000 | 0.000 | 0.000 | 0 | 1 | 111 | 1 | 55 | 2 | 0.827 | 0.073 |
| mutual-nearest-v1 | 0.85 | 0.000 | 0.000 | 0.000 | 0 | 0 | 111 | 0 | 57 | 0 | — | 0.106 |

## Original fixture (48 reviews)

| Method | Cutoff | Precision | Recall | F1 | TP | FP | FN | Groups | Singletons | Largest | Mean cohesion | ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| complete-link-v1 | 0.75 | 0.667 | 0.019 | 0.037 | 2 | 1 | 103 | 3 | 42 | 2 | 0.768 | 1.560 |
| average-link-v1 | 0.45 | 0.677 | 0.619 | 0.647 | 65 | 31 | 40 | 8 | 7 | 8 | 0.543 | 4.177 |

## Holdout (46 reviews)

| Method | Cutoff | Precision | Recall | F1 | TP | FP | FN | Groups | Singletons | Largest | Mean cohesion | ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| complete-link-v1 | 0.75 | 0.000 | 0.000 | 0.000 | 0 | 0 | 54 | 0 | 46 | 0 | — | 0.747 |
| average-link-v1 | 0.45 | 0.431 | 0.463 | 0.446 | 25 | 33 | 29 | 10 | 11 | 7 | 0.524 | 1.440 |

[Machine-readable results](issues-4.1-results.json) include similarity distributions and false-pair details for the original and holdout comparisons. Row 2 is the first fixture record. Review text and reference topics are in [the original fixture](issues-fixture.json), [development additions](issues-development-additions.json), and [holdout fixture](issues-holdout.json).

## Methods

- Complete-link merges on minimum cross-group cosine. All pairs must satisfy the cutoff.
- Average-link merges on mean cross-group cosine, updated with cluster-size weights. Individual members can have similarities below the cutoff.
- Centroid-link compares normalized sums of normalized member vectors. The implementation derives exact centroid cosine from the cached Gram matrix, with zero-norm centroids ineligible for merging.
- Mutual nearest neighbors accept disjoint reciprocal top-one pairs above the cutoff. A third review cannot attach through a single neighbor.

All methods use stable feedback IDs for tie-breaking. The hierarchical methods take O(n³) time and O(n²) space after building the matrix. The mutual-neighbor method takes O(n²) time and space, including the cached matrix.
