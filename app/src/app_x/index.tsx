import sha from './config/sha.json';

export default function BaconDegrees420() {
    return (
        <pre>{JSON.stringify(sha, null, 2)}</pre>
    );
}