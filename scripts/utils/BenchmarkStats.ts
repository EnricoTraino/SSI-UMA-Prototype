export function statistics(values: number[]){
    if(values.length == 0){
        throw new Error(
            "cannot compute statistics on empty values"
        );
    }

    const sorted =
        [...values].sort(
            (a, b) => a - b
        );

    const average =
        values.reduce(
            (sum, value) =>
                sum + value,
            0
        ) / values.length;

    const middle =
        Math.floor(
            sorted.length / 2
        );

    const median =
        sorted.length % 2 == 0
            ? (
                sorted[middle - 1] +
                sorted[middle]
            ) / 2
            : sorted[middle];

    const variance = values.length > 1? 
            values.reduce((sum , value) => sum + Math.pow(value - average , 2) , 0) / (values.length - 1)
            : 0;
    
    const standardDeviation = Math.sqrt(variance);

    const p95Position = (sorted.length - 1) * 0.95;

    const lowerIndex = Math.floor(p95Position);

    const upperIndex = Math.ceil(p95Position);

    const weigth = p95Position - lowerIndex;

    const p95 = sorted[lowerIndex] + weigth * (sorted[upperIndex] - sorted[lowerIndex]);

    return {
        average,
        median,
        standardDeviation,
        p95,
        min: sorted[0],
        max: sorted[
            sorted.length - 1
        ]
    };
}